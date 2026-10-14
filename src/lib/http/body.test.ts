import { describe, expect, it } from "vitest";
import { readCapped, readJson } from "./body";

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("http://x.test/", { method: "POST", body, headers, duplex: "half" } as RequestInit);

// A body with no Content-Length, delivered in chunks, as a client can send it.
function streamed(total: number, chunk = 1024) {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= total) return c.close();
      const n = Math.min(chunk, total - sent);
      sent += n;
      c.enqueue(new Uint8Array(n).fill(32));
    },
  });
}

describe("readCapped", () => {
  it("reads a body under the limit exactly", async () => {
    expect(await readCapped(post("hello"), 10)).toEqual(new TextEncoder().encode("hello"));
  });

  it("stops at the declared length without reading", async () => {
    expect((await readCapped(post("x".repeat(20), { "content-length": "20" }), 10)).byteLength).toBe(11);
  });

  it("stops a streamed body as soon as it passes the limit", async () => {
    expect((await readCapped(post(streamed(1_000_000)), 4096)).byteLength).toBe(4097);
  });
});

describe("readJson", () => {
  it("parses JSON, refuses a big body with 413 and a broken one with 400", async () => {
    expect(await readJson(post('{"a":1}'))).toEqual({ ok: true, value: { a: 1 } });
    const big = await readJson(post(streamed(200 * 1024)));
    expect(big.ok || big.response.status).toBe(413);
    const bad = await readJson(post("{"));
    expect(bad.ok || bad.response.status).toBe(400);
  });
});
