import { BUILD_MODE, getDataSource, modeMismatch } from "@/lib/data/server";
import { readCapped } from "@/lib/http/body";
import { LIMITS } from "@/lib/ingest/types";

// The ingest webhook (PLAN.md 15.5, openapi.yaml). Signed by the forwarder
// with the deployment's key; outside the ops Basic auth on purpose.

const NO_STORE = { "cache-control": "no-store" };

function json(status: number, body: unknown) {
  return Response.json(body, { status, headers: NO_STORE });
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
