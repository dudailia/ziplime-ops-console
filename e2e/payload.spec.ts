import { expect, test } from "@playwright/test";

// What a first visit downloads (15 Oct 2026). Every page used to ship all 14
// dry-run files in a shared JavaScript chunk, and three pages sent only a
// skeleton, painting their content after the scripts ran. Lighthouse's
// simulated phone charged both to the largest paint.

const PAGES = ["/", "/portal", "/ops", "/ops/accounts/wen-li", "/ops/intake", "/ops/inbox", "/ops/automations", "/about"];
// A raw engine line, as the file has it ("recorded_at": "2026-..."), plain or
// escaped inside a JSON string. The parser's own code names the keys, so a key
// alone would match the bundle; a key with a value only matches data.
const RAW_LINE = /recorded_at\\?": \\?"20\d\d-/;

test("no page's first load carries the dry-run files, in its HTML or its scripts", async ({ request, isMobile }) => {
  test.skip(isMobile, "the same bytes on both sizes");
  const found: string[] = [];
  for (const path of PAGES) {
    const html = await (await request.get(path)).text();
    if (RAW_LINE.test(html)) found.push(`${path}: HTML`);
    const chunks = [...new Set(html.match(/\/_next\/static\/[\w/.-]+\.js/g) ?? [])];
    for (const c of chunks) {
      if (RAW_LINE.test(await (await request.get(c)).text())) found.push(`${path}: ${c}`);
    }
  }
  expect(found).toEqual([]);
});

test("the pages driven by the address render their content on the server, not only a skeleton", async ({ request, isMobile }) => {
  test.skip(isMobile, "the same HTML on both sizes");
  const cases: [string, string][] = [
    ["/portal", "Growth rotation"],
    ["/ops/inbox", "Half the mean-reversion orders refused"],
    ["/ops/intake", "kate.obrien@example.com"],
  ];
  for (const [path, content] of cases) {
    const html = await (await request.get(path)).text();
    expect(html, path).toContain("data-default-view");
    expect(html, path).toContain(content);
  }
});

test("a file a page didn't ship is fetched when the page needs it", async ({ page }) => {
  const fetched = page.waitForRequest((r) => r.url().endsWith("/seed/dryruns/jonas-etf.jsonl"));
  await page.goto("/portal?d=jonas-etf");
  await fetched;
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("select").filter({ has: page.locator('option[value="jonas-etf"]') }).first()).toHaveValue("jonas-etf");
  const res = await page.request.get("/seed/dryruns/jonas-etf.jsonl");
  expect(res.status()).toBe(200);
  expect(await res.text()).toMatch(RAW_LINE);
});

test("files are fetched only after the first paint, and a page that needs all of them asks once", async ({ page, isMobile }) => {
  test.skip(isMobile, "the same requests on both sizes");
  await page.addInitScript(() => {
    (window as Window & { __firstPaintAt?: number }).__firstPaintAt = undefined;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        if (e.name === "first-contentful-paint") (window as Window & { __firstPaintAt?: number }).__firstPaintAt = e.startTime;
    }).observe({ type: "paint", buffered: true });
  });
  const seeds: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/seed/")) seeds.push(r.url());
  });
  await page.goto("/ops", { waitUntil: "networkidle" });
  expect(seeds.map((u) => new URL(u).pathname)).toEqual(["/seed/dryruns.json"]);
  const timing = await page.evaluate(() => {
    const paint = (window as Window & { __firstPaintAt?: number }).__firstPaintAt ?? Infinity;
    const fetches = performance.getEntriesByType("resource").filter((e) => e.name.includes("/seed/"));
    return { paint, firstFetch: Math.min(...fetches.map((e) => e.startTime)) };
  });
  expect(timing.firstFetch).toBeGreaterThan(timing.paint);
});
