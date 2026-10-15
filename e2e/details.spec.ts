import { expect, test } from "@playwright/test";

test("keyboard shortcuts: ? sheet, g-navigation, j/k rows, / search, t tour", async ({ page, isMobile }) => {
  test.skip(isMobile, "hardware keyboard only");
  await page.goto("/");
  await page.keyboard.press("?");
  const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Go to Support inbox");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  await page.keyboard.press("g");
  await page.keyboard.press("a");
  await expect(page).toHaveURL(/\/ops$/);
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  await page.keyboard.press("j");
  await expect(page.locator("[data-nav-item]").first()).toBeFocused();
  await page.keyboard.press("j");
  await expect(page.locator("[data-nav-item]").nth(1)).toBeFocused();
  await page.keyboard.press("k");
  await expect(page.locator("[data-nav-item]").first()).toBeFocused();
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox", { name: "Search accounts" })).toBeFocused();
  // Typing in a field never triggers shortcuts.
  await page.keyboard.type("ga");
  await expect(page).toHaveURL(/\/ops$/);
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 5, y: 400 } });

  await page.keyboard.press("t");
  await expect(page.getByRole("dialog")).toContainText("Step 1 of 5");
});

test("every page has its own title, an icon and a share image", async ({ page, request }) => {
  const titles: Record<string, string> = {
    "/": "ziplime Ops Console",
    "/portal": "Dry-run review | ziplime Ops Console",
    "/ops": "Accounts | ziplime Ops Console",
    "/ops/accounts/wen-li": "Wen Li | ziplime Ops Console",
    "/ops/intake": "Beta intake | ziplime Ops Console",
    "/ops/inbox": "Support inbox | ziplime Ops Console",
    "/ops/automations": "Automations | ziplime Ops Console",
    "/about": "How I built this | ziplime Ops Console",
  };
  for (const [path, title] of Object.entries(titles)) {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
  }
  await page.goto("/");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", /icon\.svg/);
  const og = await page.locator('meta[property="og:image"]').getAttribute("content");
  const res = await request.get(new URL(og!).pathname + new URL(og!).search);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
});

test("empty states say what to do next", async ({ page }) => {
  await page.goto("/ops/inbox");
  await page.getByRole("button", { name: /^Replied/ }).click();
  await expect(page.getByText("Nothing replied yet. Approve a reply and it lands here.")).toBeVisible();
  await page.getByRole("button", { name: "Show all tickets" }).click();
  await expect(page.locator("[data-nav-item]")).toHaveCount(7);
});

test("pages load without layout shift", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  for (const path of ["/", "/portal", "/ops", "/ops/accounts/wen-li", "/ops/intake", "/ops/inbox", "/ops/automations", "/about"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1200);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, path).toBeLessThan(0.05);
  }
});

test("the build log page shows docs/HOW_I_BUILT_THIS.md and is linked from every page", async ({ page }) => {
  await page.goto("/ops");
  await page.getByRole("link", { name: "How this was built" }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How I built this");
  for (const h of ["What I built and why", "How I worked with AI", "How I verified it", "What AI got wrong, and how it was caught", "What I would do differently", "Numbers"]) {
    await expect(page.getByRole("heading", { level: 2, name: h })).toBeVisible();
  }
});

test("pages and API routes send the basic security headers", async ({ request }) => {
  for (const path of ["/", "/ops", "/api/ai-status"]) {
    const r = await request.get(path);
    expect(r.headers()["x-content-type-options"], path).toBe("nosniff");
    expect(r.headers()["x-frame-options"], path).toBe("DENY");
    expect(r.headers()["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
  }
});

test("without a database the ingest and ops routes refuse cleanly, with no internals", async ({ request }) => {
  const ingest = await request.post("/api/ingest/priya-growth", { data: { first_line: 1, lines: ["{}"] } });
  expect(ingest.status()).toBe(503);
  expect(await ingest.json()).toEqual({ error: "ingest_unavailable" });
  const approve = await request.post("/api/ops/signups/su-001/approve", { data: { subject: "a", body: "b" } });
  expect(approve.status()).toBe(503);
  expect(await approve.json()).toEqual({ error: "needs_database" });
});

test("a ? pressed before the page hydrates still opens the sheet, on a 6x slower CPU", async ({ page, isMobile, browserName }) => {
  test.skip(isMobile || browserName !== "chromium", "hardware keyboard, CDP throttling");
  // Measured on a 6x slower CPU: the page paints 18 to 348 ms before React attaches
  // its keydown listener. Holding the scripts back makes that window certain.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  for (const path of ["/", "/ops", "/portal"]) {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route(/\/_next\/static\/chunks\/.*\.js/, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(path, { waitUntil: "commit" });
    await expect(page.locator("main")).toBeVisible();
    await page.keyboard.press("?");
    release();
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" }), path).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await page.unroute(/\/_next\/static\/chunks\/.*\.js/);
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
});

// Pre-ship review, 15 Oct: the early-key queue's filters, each with the scripts held back.
async function holdScripts(page: import("@playwright/test").Page, path: string) {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(/\/_next\/static\/chunks\/.*\.js/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(path, { waitUntil: "commit" });
  await expect(page.locator("main")).toBeVisible();
  return async () => {
    release();
    // Shortcuts sets the queue to null once it has replayed it.
    await page.waitForFunction(() => (window as Window & { __earlyKeys?: unknown }).__earlyKeys === null, null, { timeout: 15_000 });
    await page.waitForTimeout(300);
  };
}

test("early keys: g then a on the page is replayed as a two-key shortcut", async ({ page, isMobile }) => {
  test.skip(isMobile, "hardware keyboard only");
  const hydrate = await holdScripts(page, "/");
  await page.keyboard.press("g");
  await page.keyboard.press("a");
  await hydrate();
  await expect(page).toHaveURL(/\/ops$/);
});

test("early keys: typing into a search box before hydration is not replayed as shortcuts", async ({ page, isMobile }) => {
  test.skip(isMobile, "hardware keyboard only");
  const hydrate = await holdScripts(page, "/ops");
  await page.locator("[data-search]").first().focus();
  await page.keyboard.type("gu");
  await hydrate();
  await expect(page).toHaveURL(/\/ops$/);
});

test("early keys: a key with a modifier is not queued", async ({ page, isMobile }) => {
  test.skip(isMobile, "hardware keyboard only");
  const hydrate = await holdScripts(page, "/");
  await page.keyboard.press("Control+?");
  await hydrate();
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeHidden();
});

test("early keys: at most 8 are queued", async ({ page, isMobile }) => {
  test.skip(isMobile, "hardware keyboard only");
  const hydrate = await holdScripts(page, "/");
  for (let i = 0; i < 8; i++) await page.keyboard.press("x");
  await page.keyboard.press("g");
  await page.keyboard.press("a");
  await hydrate();
  await expect(page).toHaveURL(/\/$/);
});
