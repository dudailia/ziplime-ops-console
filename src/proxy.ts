import { NextResponse, type NextRequest } from "next/server";
import { AUTH_CHALLENGE, basicAuthUser } from "@/lib/ops/auth";

// Database mode puts the whole console behind HTTP Basic auth (PLAN.md 15.1,
// D6): it holds client data and issues secrets. The ingest webhook is left
// out in the matcher, not with an early return, so the proxy never buffers
// its body; it has its own HMAC check. The static demo passes straight through.

export function proxy(request: NextRequest) {
  if (process.env.CONSOLE_DATA_MODE !== "database") return NextResponse.next();
  const password = process.env.OPS_PASSWORD ?? "";
  if (!password) {
    return new NextResponse("This console has a database but no OPS_PASSWORD, so it stays closed. Set OPS_PASSWORD and restart.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (basicAuthUser(request.headers.get("authorization"), password)) return NextResponse.next();
  return new NextResponse("Sign in to the ziplime Ops Console.", {
    status: 401,
    headers: { ...AUTH_CHALLENGE, "content-type": "text/plain; charset=utf-8" },
  });
}

// /_next/ serves only build output (scripts, styles, fonts, the dev server's
// hot-reload socket); page data travels on page URLs, which are matched.
export const config = {
  matcher: ["/((?!api/ingest/|_next/).*)"],
};
