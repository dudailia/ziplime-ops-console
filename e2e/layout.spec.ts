import { expect, test } from "@playwright/test";

// Layout checks that a full-page screenshot can't make: the rail at a real
// desktop viewport and the tab bar at a real 390 px phone viewport.

test("the rail's background runs the full length of a long page and its nav stays in view", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop only");
  await page.goto("/portal?d=priya-growth&s=2026-10-12");
  await expect(page.getByRole("heading", { name: "Ready to go live?" })).toBeVisible();
  const rail = page.getByTestId("rail");
  const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(docHeight).toBeGreaterThan(1200);
  const box = await rail.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(docHeight - 1);
  await page.mouse.wheel(0, 2000);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Accounts" })).toBeInViewport();
});

test("the phone tab bar sits on the bottom edge with five full-size targets", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone only");
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  for (const path of ["/", "/portal", "/ops", "/ops/inbox"]) {
    await page.goto(path);
    const bar = page.getByTestId("tabbar");
    const box = (await bar.boundingBox())!;
    expect(Math.round(box.y + box.height), path).toBe(844);
    expect(box.width).toBe(390);
    const links = bar.getByRole("link");
    await expect(links).toHaveCount(5);
    for (const link of await links.all()) {
      const b = (await link.boundingBox())!;
      expect(b.height, path).toBeGreaterThanOrEqual(44);
      expect(b.width, path).toBeGreaterThanOrEqual(44);
      await expect(link).toBeInViewport({ ratio: 1 });
    }
    // Scrolled to the bottom, the footer is still reachable above the bar.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const footer = page.getByText("Unofficial concept built on the open-source");
    const fb = (await footer.boundingBox())!;
    expect(fb.y + fb.height, path).toBeLessThanOrEqual(box.y);
  }
});
