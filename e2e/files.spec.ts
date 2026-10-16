import { expect, test, type Page } from "@playwright/test";

// What the pre-ship review of the per-page data change found (15 Oct 2026).
// The first version fetched each page's files in the browser after hydration
// began; every scenario below broke under it.

// Requests a page may make after it loads: its scripts, route prefetches, the
// AI status, the icon. Anything else is data it waited for.
const EXPECTED = /\/_next\/static\/|[?&]_rsc=|\/api\/ai-status|\/icon\.svg/;
const unexpectedAfterLoad = (page: Page) => {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (!EXPECTED.test(r.url()) && r.resourceType() !== "document") seen.push(r.url());
  });
  return seen;
};

test("client navigation to another deployment's portal shows that deployment at once", async ({ page, isMobile }) => {
  test.skip(isMobile, "the rail is desktop only");
  await page.goto("/portal");
  await page.locator('a[href="/ops"]').first().click();
  await page.waitForURL("**/ops");
  await page.locator('a[href="/ops/accounts/jonas-weber"]').first().click();
  await page.waitForURL("**/ops/accounts/jonas-weber");
  const extra = unexpectedAfterLoad(page);
  await page.locator('a[href="/portal?d=jonas-etf"]').first().click();
  await page.waitForURL("**/portal?d=jonas-etf");
  // Within a moment of the address changing, not after a slow fetch.
  await expect(page.locator("select:visible").first()).toHaveValue("jonas-etf", { timeout: 1000 });
  expect(extra).toEqual([]);
});

test("no page asks for data after it loads: everything it shows came with it", async ({ page }) => {
  const seen = unexpectedAfterLoad(page);
  for (const path of ["/", "/ops", "/ops/automations", "/ops/accounts/wen-li", "/portal", "/ops/inbox"]) {
    await page.goto(path, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  }
  expect(seen).toEqual([]);
});

test("a click right after load is not lost", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("load");
  await page.getByTestId("tour-start").click();
  await expect(page).not.toHaveURL(/\/$/, { timeout: 3000 });
});

test("an inbox filter chip keeps the inbox on screen", async ({ page, isMobile }) => {
  test.skip(isMobile, "the same on both sizes");
  const extra = unexpectedAfterLoad(page);
  await page.goto("/ops/inbox");
  await page.waitForLoadState("load");
  await page.getByRole("button", { name: /^Draft flagged/ }).first().click();
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 500 });
  expect(extra).toEqual([]);
});

test("the deep-link mark is cleared on the first page change", async ({ page, isMobile }) => {
  test.skip(isMobile, "the rail is desktop only");
  await page.goto("/portal?d=jonas-etf");
  await expect(page.locator("select:visible").first()).toHaveValue("jonas-etf");
  await page.locator('a[href="/ops/inbox"]').first().click();
  await page.waitForURL("**/ops/inbox");
  await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute("data-query"))).toBe(false);
});

test("a deep link shows a skeleton, not an empty column, until the right view renders", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(/\/_next\/static\/.*\.js/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/portal?d=jonas-etf", { waitUntil: "commit" });
  await expect(page.locator("main [role=status]").first()).toBeVisible();
  release();
});

test("the old file routes are gone", async ({ request }) => {
  for (const path of ["/seed/dryruns/__proto__.jsonl", "/seed/dryruns/constructor.jsonl", "/seed/dryruns/priya-growth.jsonl", "/seed/dryruns.json"]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});

test("the first page change fades in from the first frame", async ({ page, isMobile }) => {
  test.skip(isMobile, "the rail is desktop only");
  await page.goto("/about");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    const w = window as Window & { __o?: number[] };
    w.__o = [];
    const t0 = performance.now();
    const tick = () => {
      // The visible page column showing the new page, not the old one still leaving.
      const el = [...document.querySelectorAll<HTMLElement>(".page-in")].filter((e) => e.checkVisibility()).at(-1);
      if (el && /beta intake/i.test(el.innerText.slice(0, 40))) w.__o!.push(Number(getComputedStyle(el).opacity));
      if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.locator('a[href="/ops/intake"]').first().click();
  await page.waitForURL("**/ops/intake");
  await page.waitForTimeout(600);
  const o = await page.evaluate(() => (window as Window & { __o?: number[] }).__o ?? []);
  expect(o.length).toBeGreaterThan(0);
  expect(o[0]).toBeLessThan(1);
});

test("a returning visitor's saved changes never show the seed's default view first", async ({ page, isMobile }) => {
  test.skip(isMobile, "the same on both sizes");
  // Approve the seeded draft-free ticket's template reply, so saved state differs from the seed.
  await page.goto("/ops/inbox?t=T-1042");
  await page.getByRole("button", { name: /template reply/i }).first().click();
  await page.getByRole("button", { name: /^Approve/ }).first().click();
  await page.waitForTimeout(300);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(/\/_next\/static\/.*\.js/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/ops/inbox", { waitUntil: "commit" });
  await expect(page.locator("main [role=status]").first()).toBeVisible();
  await expect(page.locator("[data-default-view]").first()).toBeHidden();
  release();
});
