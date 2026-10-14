import { BUILD_MODE, getDataSource } from "@/lib/data/server";
import { checkOpsWrite } from "@/lib/ops/auth";

// Approve a Beta signup in database mode (PLAN.md 15.7): account, deployment
// and ingest key in one transaction. The secret is in this response only.

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const check = checkOpsWrite(request, BUILD_MODE);
  if (!check.ok) return check.response;
  let email: { subject: string; body: string };
  try {
    const body = (await request.json()) as { subject?: unknown; body?: unknown };
    if (typeof body.subject !== "string" || typeof body.body !== "string" || body.subject.length > 300 || body.body.length > 10_000) throw new Error();
    email = { subject: body.subject, body: body.body };
  } catch {
    return Response.json({ error: "bad_request", reason: "Send { subject, body } with the welcome email." }, { status: 400, headers: NO_STORE });
  }
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
