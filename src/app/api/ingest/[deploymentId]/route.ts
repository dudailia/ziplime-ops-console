import { BUILD_MODE, getDataSource, modeMismatch } from "@/lib/data/server";
import { LIMITS } from "@/lib/ingest/types";

// The ingest webhook (PLAN.md 15.5, openapi.yaml). Signed by the forwarder
// with the deployment's key; outside the ops Basic auth on purpose.

const NO_STORE = { "cache-control": "no-store" };

function json(status: number, body: unknown) {
  return Response.json(body, { status, headers: NO_STORE });
}

/** The raw body bytes, read up to the limit. Anything longer comes back as limit + 1 bytes and is never read in full. */
async function readCapped(request: Request, limit: number): Promise<Uint8Array> {
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

export async function POST(request: Request, ctx: { params: Promise<{ deploymentId: string }> }) {
  if (modeMismatch()) return json(503, { error: "misconfigured" });
  if (BUILD_MODE !== "database") return json(503, { error: "ingest_unavailable" });
  try {
    const { deploymentId } = await ctx.params;
    const body = await readCapped(request, LIMITS.bodyBytes);
    const source = await getDataSource();
    const result = await source.ingest(
      deploymentId,
      body,
      { timestamp: request.headers.get("x-ziplime-timestamp"), signature: request.headers.get("x-ziplime-signature") },
      new Date(),
    );
    return json(result.status, result.body);
  } catch (exc) {
    console.error("[ingest] unexpected failure", exc);
    return json(500, { error: "internal" });
  }
}
