// Request bodies, read with a size cap so no route buffers an unbounded body.

/** The raw body bytes, read up to the limit. Anything longer comes back as limit + 1 bytes and is never read in full. */
export async function readCapped(request: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) return new Uint8Array(limit + 1);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return new Uint8Array(limit + 1);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Small JSON bodies for the app's own routes. */
export const JSON_LIMIT = 128 * 1024;

export type JsonBody = { ok: true; value: unknown } | { ok: false; response: Response };

export async function readJson(request: Request, limit = JSON_LIMIT): Promise<JsonBody> {
  const bytes = await readCapped(request, limit);
  if (bytes.byteLength > limit) return { ok: false, response: Response.json({ error: "Body is too large." }, { status: 413 }) };
  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false, response: Response.json({ error: "Body must be JSON." }, { status: 400 }) };
  }
}
