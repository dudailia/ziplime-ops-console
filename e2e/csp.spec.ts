import { expect, test } from "@playwright/test";

// The Content-Security-Policy on the production build (next.config.ts), and
// every page loading under it with no violation.
const PAGES = ["/", "/portal", "/ops", "/ops/accounts/wen-li", "/ops/intake", "/ops/inbox", "/ops/automations", "/about", "/no-such-page"];

const DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
];

test("every response carries the policy", async ({ request }) => {
  for (const path of ["/", "/portal", "/api/ai-status"]) {
    const csp = (await request.get(path)).headers()["content-security-policy"];
    expect(csp?.split(/;\s*/).sort(), path).toEqual([...DIRECTIVES].sort());
  }
});

test.describe("with motion, so the animated parts run too", () => {
  test.use({ reducedMotion: "no-preference" });

  test("every page loads with no CSP violation", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __csp: string[] };
      w.__csp = [];
      document.addEventListener("securitypolicyviolation", (e) => w.__csp.push(`${e.effectiveDirective} blocked ${e.blockedURI || "inline"}`));
    });
    const console: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy|Refused to (load|execute|apply|connect|frame)/i.test(m.text())) console.push(m.text());
    });
    const found: string[] = [];
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      for (const v of await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)) found.push(`${path}: ${v}`);
    }
    expect(found).toEqual([]);
    expect(console).toEqual([]);
  });
});
