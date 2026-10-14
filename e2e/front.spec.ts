import { expect, test } from "@playwright/test";

// The ziplime look on the front door (DESIGN.md): night by default, the hero
// and the fonts.

test("night is the default theme and a chosen light theme sticks across pages", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await bg()).toBe("rgb(0, 0, 0)");
  await expect(page.getByRole("radio", { name: "Dark" }).filter({ visible: true })).toBeChecked();

  await page.getByRole("radio", { name: "Light" }).filter({ visible: true }).click();
  expect(await bg()).toBe("rgb(246, 244, 251)");
  await page.goto("/ops");
  expect(await bg()).toBe("rgb(246, 244, 251)");

  // Auto follows the system, which this page reports as light.
  await page.getByRole("radio", { name: "Auto" }).filter({ visible: true }).click();
  expect(await bg()).toBe("rgb(246, 244, 251)");
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await bg()).toBe("rgb(0, 0, 0)");
});

test("the hero reads as one sentence with one lime word and one dot-matrix word", async ({ page }) => {
  await page.goto("/");
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toHaveText("Every order checked. Nothing sent. Now you can see why.");
  await expect(h1.locator(".t-highlight")).toHaveText("checked");
  await expect(h1.locator(".t-pixel")).toHaveText("why.");
  expect(await h1.locator(".t-pixel").evaluate((el) => getComputedStyle(el).color)).toBe("rgb(77, 207, 231)");
  // No logo or wordmark of theirs: our mark is lowercase mono text.
  await expect(page.getByRole("link", { name: "ziplime ops console" }).first()).toBeVisible();
});

test("all four faces load, and nothing on the front door shifts as they do", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const families = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.toLowerCase()));
  for (const name of ["generalsans", "inter", "jetbrains", "doto"]) {
    expect(families.some((f) => f.replace(/[^a-z]/g, "").includes(name)), name).toBe(true);
  }
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.02);
});
