// Ops access in database mode (PLAN.md 15.1, D6): HTTP Basic auth with
// OPS_PASSWORD, and a same-origin check on every write (CSRF). Used by
// proxy.ts for every page and again by each ops route, so a mistake in the
// proxy's matcher can't open a write route.

import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** The user name if the Authorization header carries the right password, else null. */
export function basicAuthUser(header: string | null, password: string): string | null {
  if (!header || !password) return null;
  const m = /^Basic ([A-Za-z0-9+/]+=*)$/.exec(header.trim());
  if (!m) return null;
  const decoded = Buffer.from(m[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 0) return null;
  const user = decoded.slice(0, colon);
  // Equal-length digests, compared in constant time.
  if (!timingSafeEqual(digest(decoded.slice(colon + 1)), digest(password))) return null;
  return user.trim().slice(0, 64) || "ops";
}

export const AUTH_CHALLENGE = { "WWW-Authenticate": 'Basic realm="ziplime Ops Console", charset="UTF-8"' };

/**
 * A browser sends Basic credentials with cross-site requests too, so writes
 * also need proof the request came from this console's own pages.
 */
export function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export type OpsCheck = { ok: true; user: string } | { ok: false; response: Response };

/** Every ops write: a database build, Basic auth, same origin, JSON. */
export function checkOpsWrite(request: Request, mode: string): OpsCheck {
  const fail = (status: number, error: string, headers: Record<string, string> = {}) => ({
    ok: false as const,
    response: Response.json({ error }, { status, headers: { "cache-control": "no-store", ...headers } }),
  });
  if (mode !== "database") return fail(503, "needs_database");
  const password = process.env.OPS_PASSWORD ?? "";
  if (!password) return fail(503, "ops_password_not_set");
  const user = basicAuthUser(request.headers.get("authorization"), password);
  if (!user) return fail(401, "unauthorized", AUTH_CHALLENGE);
  if (!sameOrigin(request)) return fail(403, "cross_site");
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return fail(415, "json_only");
  return { ok: true, user };
}
