import { BUILD_MODE, getDataSource } from "@/lib/data/server";
import { checkOpsWrite } from "@/lib/ops/auth";

// Issue a new ingest key for a deployment. The old key stops working at once.
// The secret is in this response only.

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const check = checkOpsWrite(request, BUILD_MODE);
  if (!check.ok) return check.response;
  try {
    const { id } = await ctx.params;
    const out = await (await getDataSource()).rotateKey(id, check.user);
    if (!out) return Response.json({ error: "unknown_deployment" }, { status: 404, headers: NO_STORE });
    return Response.json(out, { headers: NO_STORE });
  } catch (exc) {
    console.error("[ops] key rotation failed", exc);
    return Response.json({ error: "internal" }, { status: 500, headers: NO_STORE });
  }
}
