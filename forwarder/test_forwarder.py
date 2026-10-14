"""Tests for the forwarder, against a real HTTP server on localhost.

    python -m pytest forwarder -q

The fake console checks signatures the way the real one does and answers
from a script, so retries, refusals and gaps can be played out exactly.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ziplime_forwarder as fw  # noqa: E402

VECTORS = json.loads((Path(__file__).resolve().parent / "test_vectors.json").read_text(encoding="utf-8"))
SECRET = bytes(range(32))
NOW = 1_791_936_000


class FakeConsole:
    """Records every request; answers with the next scripted status, then 200."""

    def __init__(self) -> None:
        self.requests: list[dict] = []
        self.script: list[tuple[int, dict]] = []
        self.stored: dict[int, str] = {}
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802 (http.server's name)
                body = self.rfile.read(int(self.headers["Content-Length"]))
                ts = self.headers["X-Ziplime-Timestamp"]
                good = hmac.compare_digest(self.headers["X-Ziplime-Signature"], fw.sign(SECRET, ts, body))
                data = json.loads(body)
                outer.requests.append({"body": body, "data": data, "timestamp": ts, "signed": good})
                status, payload = outer.script.pop(0) if outer.script else (200, None)
                if status == 200 and payload is None:
                    payload = outer.accept(data)
                out = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(out)))
                self.end_headers()
                self.wfile.write(out)

            def log_message(self, *args: object) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/api/ingest/dep"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def accept(self, data: dict) -> dict:
        results = []
        for i, line in enumerate(data["lines"]):
            n = data["first_line"] + i
            status = "duplicate" if self.stored.get(n) == line else "accepted"
            self.stored[n] = line
            results.append({"line": n, "status": status})
        accepted = sum(r["status"] == "accepted" for r in results)
        return {"received": len(results), "accepted": accepted, "duplicate": len(results) - accepted, "rejected": 0, "ignored": 0, "replay": False, "results": results}

    def lines_sent(self) -> list[int]:
        return [r["data"]["first_line"] + i for r in self.requests for i in range(len(r["data"]["lines"]))]

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def console():
    c = FakeConsole()
    yield c
    c.close()


def engine_line(n: int) -> str:
    return json.dumps({"event": "skip", "n": n, "reason": "below one lot"}, sort_keys=True)


def write(path: Path, start: int, count: int, mode: str = "a") -> None:
    with open(path, mode, encoding="utf-8") as handle:
        for n in range(start, start + count):
            handle.write(engine_line(n) + "\n")


def make(tmp_path: Path, console: FakeConsole, **kw) -> tuple[fw.Forwarder, list[float], list[str]]:
    sleeps: list[float] = []
    logs: list[str] = []
    f = fw.Forwarder(
        str(tmp_path / "run.jsonl"),
        console.url,
        SECRET,
        str(tmp_path / "state.json"),
        sleep=sleeps.append,
        clock=lambda: NOW,
        log=logs.append,
        **kw,
    )
    return f, sleeps, logs


def test_signs_exactly_like_the_console():
    v = VECTORS["signature"]
    assert fw.sign(bytes.fromhex(v["secret_hex"]), v["timestamp"], v["body"].encode()) == v["header"]
    assert hashlib.sha256(VECTORS["content_hash"]["line"].encode("utf-8")).hexdigest() == VECTORS["content_hash"]["sha256"]


def test_batches_by_line_count(tmp_path, console):
    write(tmp_path / "run.jsonl", 1, 1200)
    f, _, _ = make(tmp_path, console)
    assert f.run_once() == 1200
    assert [(r["data"]["first_line"], len(r["data"]["lines"])) for r in console.requests] == [(1, 500), (501, 500), (1001, 200)]
    assert all(r["signed"] for r in console.requests)
    assert console.requests[0]["data"]["lines"][0] == engine_line(1)


def test_batches_by_bytes(tmp_path, console):
    write(tmp_path / "run.jsonl", 1, 30)
    f, _, _ = make(tmp_path, console, batch_bytes=600)
    f.run_once()
    assert len(console.requests) > 3
    assert max(len(r["body"]) for r in console.requests) <= 600
    assert max(len(r["body"]) for r in console.requests) > 450  # and the batches are actually filled
    assert console.lines_sent() == list(range(1, 31))


def test_holds_back_a_half_written_line(tmp_path, console):
    path = tmp_path / "run.jsonl"
    write(path, 1, 2)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write('{"event": "pla')
    f, _, _ = make(tmp_path, console)
    assert f.run_once() == 2
    with open(path, "a", encoding="utf-8") as handle:
        handle.write('ce"}\n')
    assert f.run_once() == 1
    assert console.requests[-1]["data"] == {"file": "run.jsonl", "first_line": 3, "lines": ['{"event": "place"}']}


def test_never_posts_an_empty_batch(tmp_path, console):
    (tmp_path / "run.jsonl").write_text("", encoding="utf-8")
    f, _, _ = make(tmp_path, console)
    assert f.run_once() == 0
    assert console.requests == []


def test_a_restart_resumes_without_resending(tmp_path, console):
    path = tmp_path / "run.jsonl"
    write(path, 1, 5)
    f, _, _ = make(tmp_path, console)
    f.run_once()
    again, _, _ = make(tmp_path, console)  # a new process, same state file
    assert again.run_once() == 0
    write(path, 6, 3)
    assert again.run_once() == 3
    assert console.lines_sent() == list(range(1, 9))
    state = json.loads((tmp_path / "state.json").read_text())
    assert state["next_line"] == 9 and state["offset"] == path.stat().st_size


def test_retries_with_backoff_and_the_same_body(tmp_path, console):
    write(tmp_path / "run.jsonl", 1, 3)
    console.script = [(503, {"error": "x"}), (502, {"error": "x"}), (429, {"error": "x"})]
    f, sleeps, logs = make(tmp_path, console)
    assert f.run_once() == 3
    assert len(console.requests) == 4
    assert len({r["body"] for r in console.requests}) == 1
    # 1 s doubling, with jitter between half and all of each step.
    assert [0.5 <= s / step <= 1.0 for s, step in zip(sleeps, [1, 2, 4])] == [True, True, True]
    assert "Try 1 of 8 failed (HTTP 503)" in logs[0]


def test_does_not_retry_a_refusal_and_keeps_its_place(tmp_path, console):
    write(tmp_path / "run.jsonl", 1, 3)
    console.script = [(401, {"error": "unauthorized"})]
    f, sleeps, _ = make(tmp_path, console)
    with pytest.raises(fw.ForwarderError) as err:
        f.run_once()
    assert err.value.code == fw.EXIT_REFUSED
    assert "HTTP 401" in str(err.value)
    assert len(console.requests) == 1 and sleeps == []
    assert json.loads((tmp_path / "state.json").read_text())["offset"] == 0


def test_gives_up_after_every_try_without_moving_on(tmp_path, console):
    write(tmp_path / "run.jsonl", 1, 3)
    console.script = [(503, {})] * 3
    f, _, _ = make(tmp_path, console, max_tries=3)
    with pytest.raises(fw.ForwarderError) as err:
        f.run_once()
    assert err.value.code == fw.EXIT_UNREACHABLE
    assert json.loads((tmp_path / "state.json").read_text())["next_line"] == 1


def test_retries_when_the_console_is_down(tmp_path):
    path = tmp_path / "run.jsonl"
    write(path, 1, 1)
    f = fw.Forwarder(str(path), "http://127.0.0.1:9/api/ingest/dep", SECRET, str(tmp_path / "s.json"), max_tries=2, sleep=lambda s: None, clock=lambda: NOW, log=lambda m: None)
    with pytest.raises(fw.ForwarderError) as err:
        f.run_once()
    assert err.value.code == fw.EXIT_UNREACHABLE


def test_rewinds_on_a_gap(tmp_path, console):
    path = tmp_path / "run.jsonl"
    write(path, 1, 5)
    f, _, logs = make(tmp_path, console)
    f.run_once()
    write(path, 6, 2)
    console.script = [(409, {"error": "gap", "expected_at_most": 3})]  # say the console lost lines 3 to 5
    f.run_once()
    assert [r["data"]["first_line"] for r in console.requests] == [1, 6, 3]
    assert console.requests[-1]["data"]["lines"] == [engine_line(n) for n in range(3, 8)]
    assert any("expects line 3" in m for m in logs)


def test_keeps_counting_lines_across_a_rotated_file(tmp_path, console):
    path = tmp_path / "run.jsonl"
    write(path, 1, 4)
    f, _, _ = make(tmp_path, console)
    f.run_once()
    os.rename(path, tmp_path / "run.jsonl.1")
    write(path, 100, 2, mode="w")  # a new file at the same path, so a new inode
    f.run_once()
    assert console.requests[-1]["data"]["first_line"] == 5
    assert console.requests[-1]["data"]["lines"] == [engine_line(100), engine_line(101)]


def test_stops_when_the_file_shrank(tmp_path, console):
    path = tmp_path / "run.jsonl"
    write(path, 1, 4)
    f, _, _ = make(tmp_path, console)
    f.run_once()
    with open(path, "r+", encoding="utf-8") as handle:
        handle.truncate(10)
    with pytest.raises(fw.ForwarderError, match="shrank"):
        f.run_once()


def test_stops_on_a_line_too_big_for_any_batch(tmp_path, console):
    path = tmp_path / "run.jsonl"
    path.write_text('{"x": "' + "y" * 2000 + '"}\n', encoding="utf-8")
    f, _, _ = make(tmp_path, console, batch_bytes=1000)
    with pytest.raises(fw.ForwarderError, match="too big"):
        f.run_once()
    assert console.requests == []


def test_secret_file_must_be_private(tmp_path):
    secret = tmp_path / "dep.secret"
    secret.write_text(SECRET.hex() + "\n", encoding="utf-8")
    os.chmod(secret, 0o644)
    with pytest.raises(fw.ForwarderError, match="chmod 600"):
        fw.read_secret(str(secret), {})
    os.chmod(secret, 0o600)
    assert fw.read_secret(str(secret), {}) == SECRET


def test_secret_from_the_environment_and_bad_secrets(tmp_path):
    assert fw.read_secret(None, {"ZIPLIME_INGEST_SECRET": SECRET.hex().upper()}) == SECRET
    with pytest.raises(fw.ForwarderError, match="No secret"):
        fw.read_secret(None, {})
    with pytest.raises(fw.ForwarderError, match="64 hex"):
        fw.read_secret(None, {"ZIPLIME_INGEST_SECRET": "abc"})


def test_the_secret_never_reaches_the_state_file_or_the_log(tmp_path, console):
    write(tmp_path / "run.jsonl", 1, 2)
    f, _, logs = make(tmp_path, console)
    f.run_once()
    assert SECRET.hex() not in (tmp_path / "state.json").read_text()
    assert all(SECRET.hex() not in m for m in logs)


def test_a_state_file_for_another_file_is_refused(tmp_path, console):
    write(tmp_path / "run.jsonl", 1, 1)
    f, _, _ = make(tmp_path, console)
    f.run_once()
    other = tmp_path / "other.jsonl"
    write(other, 1, 1)
    g = fw.Forwarder(str(other), console.url, SECRET, str(tmp_path / "state.json"), sleep=lambda s: None, clock=lambda: NOW, log=lambda m: None)
    with pytest.raises(fw.ForwarderError, match="belongs to"):
        g.run_once()


def test_main_reports_a_missing_secret_with_exit_code_2(tmp_path, capsys, monkeypatch):
    monkeypatch.delenv("ZIPLIME_INGEST_SECRET", raising=False)
    write(tmp_path / "run.jsonl", 1, 1)
    code = fw.main(["--file", str(tmp_path / "run.jsonl"), "--url", "http://127.0.0.1:9/x", "--state", str(tmp_path / "s.json"), "--once"])
    assert code == fw.EXIT_CONFIG
    assert "No secret" in capsys.readouterr().err
