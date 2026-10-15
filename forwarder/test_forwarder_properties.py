"""Property tests for read_lines (night run, 15 Oct 2026).

The engine appends to the file while the forwarder reads it, so a read can
land in the middle of a line or of a multi-byte character. Whatever the
appends look like, read_lines must return only complete lines, decoded from
their complete bytes, in order, each exactly once.

The seeded loop always runs (standard library only, like the forwarder).
With hypothesis installed (pip install -r forwarder/requirements-test.txt)
the same property also runs under hypothesis, which shrinks a failure.
"""

from __future__ import annotations

import os
import random
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ziplime_forwarder as fw  # noqa: E402

# Pieces a file is made of: ASCII, newlines, multi-byte characters (2, 3 and
# 4 bytes in UTF-8) and bytes that aren't UTF-8 at all.
PIECES = [b"a", b"{\"k\": 1}", b"\n", b"\r\n", "é".encode(), "€".encode(), "🚀".encode(), b"\xff", b"\xc3", b"\x00"]


def drain(path: Path, offset: int, first_line: int, batch_lines: int, batch_bytes: int) -> tuple[list[str], int]:
    """Everything read_lines returns from offset on, batch after batch."""
    out: list[str] = []
    while True:
        lines, end, _ = fw.read_lines(path, offset, batch_lines, batch_bytes, first_line + len(out))
        if not lines:
            return out, offset
        assert end > offset
        out.extend(lines)
        offset = end


def check(tmp: Path, chunks: list[bytes], batch_lines: int, batch_bytes: int) -> None:
    path = tmp / "run.jsonl"
    path.write_bytes(b"")
    got: list[str] = []
    offset = 0
    written = b""
    for chunk in chunks:
        with open(path, "ab") as handle:
            handle.write(chunk)
        written += chunk
        lines, offset = drain(path, offset, 1, batch_lines, batch_bytes)
        got.extend(lines)
        # The offset always sits just after a newline (or at the start): never inside a line.
        assert offset == written.rfind(b"\n") + 1
    complete = written[: written.rfind(b"\n") + 1].split(b"\n")[:-1]
    assert got == [line.decode("utf-8", errors="replace") for line in complete]
    assert all("\n" not in line for line in got)


def random_chunks(rng: random.Random) -> list[bytes]:
    data = b"".join(rng.choice(PIECES) for _ in range(rng.randint(0, 60)))
    cuts = sorted(rng.sample(range(len(data) + 1), k=min(len(data) + 1, rng.randint(0, 8))))
    edges = [0, *cuts, len(data)]
    return [data[a:b] for a, b in zip(edges, edges[1:])]


def test_read_lines_seeded_loop(tmp_path):
    seed = int(os.environ.get("FUZZ_SEED", "20261015"))
    rng = random.Random(seed)
    for case in range(1000):
        chunks = random_chunks(rng)
        sub = tmp_path / str(case)
        sub.mkdir()
        try:
            check(sub, chunks, rng.randint(1, 5), rng.choice([200, 1000, 900_000]))
        except AssertionError:
            pytest.fail(f"seed {seed}, case {case}: chunks={chunks!r}")


try:
    import hypothesis
    from hypothesis import strategies as st
except ImportError:  # the seeded loop above still ran
    hypothesis = None

if hypothesis is None:

    @pytest.mark.skip(reason="hypothesis not installed (pip install -r forwarder/requirements-test.txt); the seeded loop still ran")
    def test_read_lines_hypothesis():
        pass

else:

    @hypothesis.settings(max_examples=1000, deadline=None, derandomize=not os.environ.get("FUZZ_RANDOM"))
    @hypothesis.given(
        pieces=st.lists(st.sampled_from(PIECES), max_size=60),
        cuts=st.lists(st.integers(min_value=0, max_value=10_000), max_size=8),
        batch_lines=st.integers(min_value=1, max_value=5),
        batch_bytes=st.sampled_from([200, 1000, 900_000]),
    )
    def test_read_lines_hypothesis(tmp_path_factory, pieces, cuts, batch_lines, batch_bytes):
        data = b"".join(pieces)
        edges = [0, *sorted({c % (len(data) + 1) for c in cuts}), len(data)]
        check(tmp_path_factory.mktemp("h"), [data[a:b] for a, b in zip(edges, edges[1:])], batch_lines, batch_bytes)
