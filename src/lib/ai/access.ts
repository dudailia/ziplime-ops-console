// Who may make the console spend Claude tokens (audit, 14 Oct 2026).
//
// In database mode every route sits behind the ops Basic auth (proxy.ts). The
// static demo has no sign-in at all, so on a public deployment a key would let
// anyone on the internet use /api/explain as a free Claude endpoint: it takes
// a 1,000-character reason string from the request. docs/PUBLISH.md says to
// keep the key off the public demo; this makes the code say it too.

import { sameOrigin } from "../ops/auth";

type Env = Record<string, string | undefined>;

export type AiAccess = { enabled: true } | { enabled: false; reason: "no_key" | "public_demo" };

export function aiAccess(env: Env = process.env): AiAccess {
  if (!env.ANTHROPIC_API_KEY?.trim()) return { enabled: false, reason: "no_key" };
  // A static build has no sign-in. Served anywhere but next dev on your own machine
  // (Vercel, next start, Docker), it is a public demo, so AI stays off: fail closed,
  // whatever the host. Vercel sets VERCEL=1; other hosts set NODE_ENV=production.
  const publicDemo = env.CONSOLE_DATA_MODE !== "database" && (env.VERCEL === "1" || env.NODE_ENV !== "development");
  if (publicDemo && env.ZIPLIME_ALLOW_PUBLIC_AI !== "true") return { enabled: false, reason: "public_demo" };
  return { enabled: true };
}

export const AI_OFF_MESSAGE: Record<"no_key" | "public_demo", string> = {
  no_key: "AI drafting is off: ANTHROPIC_API_KEY is not set.",
  public_demo:
    "AI drafting is off on the public demo: it has no sign-in, so a key would let anyone spend it. Run the console with npm run dev or in database mode.",
};

/**
 * The checks every AI route makes before reading its body: the console's own
 * pages, JSON. A browser sends Basic credentials cross-site too, so without
 * this a page elsewhere could make a signed-in reviewer's browser spend tokens.
 */
export function aiRequestProblem(request: Request): { status: number; error: string } | null {
  if (!sameOrigin(request)) return { status: 403, error: "cross_site" };
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return { status: 415, error: "json_only" };
  return null;
}
