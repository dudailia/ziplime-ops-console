import { BUILD_MODE, getDataSource } from "@/lib/data/server";
import { readJson } from "@/lib/http/body";
import { checkOpsWrite } from "@/lib/ops/auth";

// Approve a Beta signup in database mode (PLAN.md 15.7): account, deployment
// and ingest key in one transaction. The secret is in this response only.

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const check = checkOpsWrite(request, BUILD_MODE);
  if (!check.ok) return check.response;
  const read = await readJson(request, 32 * 1024);
  if (!read.ok) return read.response;
  const body = (read.value ?? {}) as { subject?: unknown; body?: unknown };
  if (typeof body.subject !== "string" || typeof body.body !== "string" || body.subject.length > 300 || body.body.length > 10_000) {
    return Response.json({ error: "bad_request", reason: "Send { subject, body } with the welcome email." }, { status: 400, headers: NO_STORE });
  }
  const email = { subject: body.subject, body: body.body };
  try {
    const { id } = await ctx.params;
    const result = await (await getDataSource()).approveSignup({ signupId: id, by: check.user, at: new Date().toISOString(), email });
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status, headers: NO_STORE });
    return Response.json(result.onboarded, { headers: NO_STORE });
  } catch (exc) {
    console.error("[ops] approve failed", exc);
    return Response.json({ error: "internal" }, { status: 500, headers: NO_STORE });
  }
}
