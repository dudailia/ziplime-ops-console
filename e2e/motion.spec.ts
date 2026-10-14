import { expect, test } from "@playwright/test";

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("numbers show their final value at once and nothing moves", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".countup [data-state]").first()).toHaveText("487");
    await expect(page.locator(".countup [data-state]").first()).toHaveAttribute("data-state", "done");
    const mark = page.locator(".clock-mark").first();
    expect(await mark.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    const main = page.locator(".page-in").first();
    expect(await main.evaluate((el) => getComputedStyle(el).animationName)).toBe("fade-in");
  });
});

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("KPIs count up to the real value, once per page load", async ({ page }) => {
    await page.goto("/");
    const first = page.locator(".countup [data-state]").first();
    await expect(first).toHaveAttribute("data-state", "done");
    await expect(first).toHaveText("487");
    // The accessible value never counts.
    await expect(page.locator(".countup .sr-only").first()).toHaveText("487");
    // Client-side back to the front door: already counted, so it's done at once.
    await page.getByRole("link", { name: "Open the portal" }).click();
    await page.getByRole("link", { name: /ziplime/ }).first().click();
    await expect(page.locator(".countup [data-state]").first()).toHaveAttribute("data-state", "done");
  });

  test("page changes finish within 250 ms", async ({ page }) => {
    await page.goto("/ops");
    const d = await page.locator(".page-in").first().evaluate((el) => {
      const s = getComputedStyle(el);
      return parseFloat(s.animationDuration) * (s.animationDuration.endsWith("ms") ? 1 : 1000);
    });
    expect(d).toBeLessThanOrEqual(250);
  });
});
