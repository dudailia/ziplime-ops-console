#!/usr/bin/env python3
"""Forward a ziplime dry-run file to the ziplime Ops Console.

Runs next to the engine. ziplime's dry-run mode appends one JSON line per
order event to a file (LimeTraderSdkExchange._write_dry_run_record, append
mode, fsync per line). This script reads the lines added since it last ran,
sends them in batches to the console's ingest webhook, signed with the
deployment's key, and remembers how far it got, so a restart never resends.

Python standard library only. It changes nothing in ziplime.

    python forwarder/ziplime_forwarder.py \\
        --file run/greta.jsonl \\
        --url http://localhost:3000/api/ingest/greta-dryrun \\
        --secret-file ~/.ziplime/greta-dryrun.secret \\
        --state run/greta.forwarder.json --once

The secret comes from --secret-file (a file only you can read) or the
ZIPLIME_INGEST_SECRET environment variable, never from a flag value, because
flag values show up in `ps`.

Exit codes: 0 done, 2 bad configuration, 3 the console refused a batch,
4 the console could not be reached after every retry. Without --once it keeps
running; run it under a supervisor (systemd, launchd, a container restart
policy) so a long outage doesn't stop it for good.
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import hmac
import http.client
import json
import os
import random
import stat
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable

BATCH_LINES = 500
# The console takes bodies up to 1 MB; stay well under it.
BATCH_BYTES = 900_000
MAX_TRIES = 8
BACKOFF_FIRST = 1.0
BACKOFF_CAP = 60.0
TIMEOUT = 30.0
RETRY_STATUSES = {429, 500, 502, 503, 504}

EXIT_CONFIG = 2
EXIT_REFUSED = 3
EXIT_UNREACHABLE = 4


class ForwarderError(Exception):
    """Something a person has to fix. Carries the process exit code."""

    def __init__(self, message: str, code: int) -> None:
        super().__init__(message)
        self.code = code


@dataclasses.dataclass
class State:
    path: str
    inode: int
    offset: int
    next_line: int
    # Stream line number of this file's first line. Lines keep counting across a rotation.
    file_first_line: int


def sign(secret: bytes, timestamp: str, body: bytes) -> str:
    """The X-Ziplime-Signature header: v1= and the hex HMAC-SHA256 of '<timestamp>.<body>'."""
    return "v1=" + hmac.new(secret, timestamp.encode("ascii") + b"." + body, hashlib.sha256).hexdigest()


def read_secret(secret_file: str | None, environ: dict[str, str]) -> bytes:
    if secret_file:
        path = Path(secret_file).expanduser()
        try:
            mode = path.stat().st_mode
        except OSError as exc:
            raise ForwarderError(f"Can't read the secret file {path}: {exc.strerror}", EXIT_CONFIG) from exc
        if mode & (stat.S_IRWXG | stat.S_IRWXO):
            raise ForwarderError(f"{path} can be read by other users. Run: chmod 600 {path}", EXIT_CONFIG)
        text = path.read_text(encoding="utf-8").strip()
    else:
        text = environ.get("ZIPLIME_INGEST_SECRET", "").strip()
        if not text:
            raise ForwarderError("No secret: pass --secret-file or set ZIPLIME_INGEST_SECRET.", EXIT_CONFIG)
    text = text.lower()
    if len(text) != 64 or any(c not in "0123456789abcdef" for c in text):
        raise ForwarderError("The secret must be the 64 hex characters the console showed.", EXIT_CONFIG)
    return bytes.fromhex(text)


def load_state(state_path: Path) -> State | None:
    try:
        data = json.loads(state_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as exc:
        raise ForwarderError(f"Can't read the state file {state_path}: {exc}", EXIT_CONFIG) from exc
    try:
        return State(**{f.name: data[f.name] for f in dataclasses.fields(State)})
    except (KeyError, TypeError) as exc:
        raise ForwarderError(f"The state file {state_path} isn't one this forwarder wrote.", EXIT_CONFIG) from exc


def save_state(state_path: Path, state: State) -> None:
    """Atomic: a crash leaves either the old state or the new one, never half of one."""
    tmp = state_path.with_name(state_path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(dataclasses.asdict(state), handle, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, state_path)


def batch_body(file_name: str, first_line: int, lines: list[str]) -> bytes:
    return json.dumps({"file": file_name, "first_line": first_line, "lines": lines}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def read_lines(path: Path, offset: int, max_lines: int, max_bytes: int, first_line: int = 1) -> tuple[list[str], int]:
    """Complete lines after offset, within the batch limits. A last line with no newline yet waits."""
    lines: list[str] = []
    # The body's own bytes count too: the file name, first_line and the brackets.
    size = len(batch_body(path.name, first_line, []))
    with open(path, "rb") as handle:
        handle.seek(offset)
        while len(lines) < max_lines:
            raw = handle.readline()
            if not raw.endswith(b"\n"):
                break  # end of file, or a line still being written
            text = raw[:-1].decode("utf-8", errors="replace")
            cost = len(json.dumps(text, ensure_ascii=False).encode("utf-8")) + (1 if lines else 0)
            if lines and size + cost > max_bytes:
                break
            if not lines and size + cost > max_bytes:
                raise ForwarderError(
                    f"A line of {len(raw)} bytes is too big to send in one batch. ziplime writes lines under 1 KB, so the file may be damaged.",
                    EXIT_REFUSED,
                )
            lines.append(text)
            size += cost
            offset += len(raw)
    return lines, offset


def offset_of_line(path: Path, line_index: int) -> int:
    """Byte offset where the given 0-based line of the file starts."""
    offset = 0
    with open(path, "rb") as handle:
        for _ in range(line_index):
            raw = handle.readline()
            if not raw.endswith(b"\n"):
                raise ForwarderError(f"{path} has fewer than {line_index} complete lines.", EXIT_REFUSED)
            offset += len(raw)
    return offset


class Forwarder:
    def __init__(
        self,
        file: str,
        url: str,
        secret: bytes,
        state_path: str,
        batch_lines: int = BATCH_LINES,
        batch_bytes: int = BATCH_BYTES,
        max_tries: int = MAX_TRIES,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.time,
        log: Callable[[str], None] = lambda message: print(message, flush=True),
    ) -> None:
        self.path = Path(file).resolve()
        self.url = url
        self.secret = secret
        self.state_path = Path(state_path)
        self.batch_lines = batch_lines
        self.batch_bytes = batch_bytes
        self.max_tries = max_tries
        self.sleep = sleep
        self.clock = clock
        self.log = log

    def _state(self) -> State:
        try:
            st = os.stat(self.path)
        except FileNotFoundError as exc:
            raise ForwarderError(f"{self.path} doesn't exist yet.", EXIT_CONFIG) from exc
        state = load_state(self.state_path)
        if state is None:
            return State(str(self.path), st.st_ino, 0, 1, 1)
        if state.path != str(self.path):
            raise ForwarderError(f"The state file belongs to {state.path}, not {self.path}. Use a state file per dry-run file.", EXIT_CONFIG)
        if st.st_ino != state.inode:
            # Rotated: a new file at the same path. Keep counting lines from where the old one ended.
            self.log(f"{self.path} is a new file; continuing from stream line {state.next_line}.")
            return State(state.path, st.st_ino, 0, state.next_line, state.next_line)
        if st.st_size < state.offset:
            raise ForwarderError(
                f"{self.path} shrank below the {state.offset} bytes already sent. ziplime only appends, so something rewrote it; not guessing.",
                EXIT_REFUSED,
            )
        return state

    def run_once(self) -> int:
        """Sends everything that's complete now. Returns how many lines were sent."""
        state = self._state()
        save_state(self.state_path, state)
        sent = 0
        while True:
            lines, end = read_lines(self.path, state.offset, self.batch_lines, self.batch_bytes, state.next_line)
            if not lines:
                return sent
            body = batch_body(self.path.name, state.next_line, lines)
            result = self._post(body)
            if "expected_at_most" in result:
                state = self._rewind(state, int(result["expected_at_most"]))
                save_state(self.state_path, state)
                continue
            self._report(state.next_line, result)
            state = dataclasses.replace(state, offset=end, next_line=state.next_line + len(lines))
            save_state(self.state_path, state)
            sent += len(lines)

    def run_forever(self, interval: float) -> None:
        while True:
            self.run_once()
            self.sleep(interval)

    def _rewind(self, state: State, expected: int) -> State:
        if expected < state.file_first_line:
            raise ForwarderError(
                f"The console expects line {expected}, which is before this file starts (line {state.file_first_line}). Can't rewind into an older file.",
                EXIT_REFUSED,
            )
        self.log(f"The console expects line {expected}; resending from there.")
        offset = offset_of_line(self.path, expected - state.file_first_line)
        return dataclasses.replace(state, offset=offset, next_line=expected)

    def _post(self, body: bytes) -> dict:
        """POSTs one batch. The body bytes stay the same on every try, so a retry the console already stored comes back as a replay."""
        delay = BACKOFF_FIRST
        last = ""
        for attempt in range(1, self.max_tries + 1):
            timestamp = str(int(self.clock()))
            request = urllib.request.Request(
                self.url,
                data=body,
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "X-Ziplime-Timestamp": timestamp,
                    "X-Ziplime-Signature": sign(self.secret, timestamp, body),
                    "User-Agent": "ziplime-forwarder/1",
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                text = exc.read().decode("utf-8", errors="replace")[:500]
                if exc.code == 409:
                    try:
                        detail = json.loads(text)
                    except ValueError:
                        detail = {}
                    if isinstance(detail.get("expected_at_most"), int):
                        return {"expected_at_most": detail["expected_at_most"]}
                if exc.code not in RETRY_STATUSES:
                    raise ForwarderError(f"The console refused the batch: HTTP {exc.code} {text}", EXIT_REFUSED) from exc
                last = f"HTTP {exc.code}"
            except (urllib.error.URLError, http.client.HTTPException, ConnectionError, TimeoutError, OSError) as exc:
                last = str(getattr(exc, "reason", exc))
            if attempt < self.max_tries:
                wait = delay * (0.5 + random.random() / 2)
                self.log(f"Try {attempt} of {self.max_tries} failed ({last}); retrying in {wait:.1f} s.")
                self.sleep(wait)
                delay = min(delay * 2, BACKOFF_CAP)
        raise ForwarderError(f"Gave up after {self.max_tries} tries: {last}", EXIT_UNREACHABLE)

    def _report(self, first: int, result: dict) -> None:
        received = result.get("received", 0)
        span = f"Lines {first} to {first + received - 1}"
        if result.get("replay"):
            self.log(f"{span}: the console already had this exact batch; nothing new stored.")
            return
        parts = [f"{result.get(k, 0)} {k}" for k in ("accepted", "duplicate", "rejected", "ignored") if result.get(k)]
        self.log(f"{span}: {', '.join(parts) or 'nothing new'}.")
        for r in result.get("results", []):
            if r.get("status") == "rejected":
                self.log(f"  line {r.get('line')} rejected: {r.get('reason')}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Forward a ziplime dry-run file to the ziplime Ops Console.")
    parser.add_argument("--file", required=True, help="the dry-run file ziplime writes (dry_run_file=...)")
    parser.add_argument("--url", required=True, help="the console's ingest URL for this deployment")
    parser.add_argument("--state", required=True, help="where to remember how far this file was sent")
    parser.add_argument("--secret-file", help="a file holding the 64-character ingest secret, readable only by you")
    parser.add_argument("--once", action="store_true", help="send what's there now, then exit")
    parser.add_argument("--interval", type=float, default=2.0, help="seconds between checks when running continuously")
    parser.add_argument("--batch-lines", type=int, default=BATCH_LINES)
    parser.add_argument("--max-tries", type=int, default=MAX_TRIES)
    args = parser.parse_args(argv)
    try:
        forwarder = Forwarder(
            args.file,
            args.url,
            read_secret(args.secret_file, dict(os.environ)),
            args.state,
            batch_lines=max(1, min(args.batch_lines, 1000)),
            max_tries=max(1, args.max_tries),
        )
        if args.once:
            forwarder.run_once()
        else:
            forwarder.run_forever(args.interval)
    except ForwarderError as exc:
        print(f"ziplime-forwarder: {exc}", file=sys.stderr)
        return exc.code
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
