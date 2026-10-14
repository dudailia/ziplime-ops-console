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
  for (const path of ["/", "/portal", "/ops", "/ops/accounts/wen-li", "/ops/intake", "/ops/inbox", "/ops/automations"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1200);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, path).toBeLessThan(0.05);
  }
});
