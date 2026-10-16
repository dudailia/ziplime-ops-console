import { expect, test } from "@playwright/test";

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("numbers show their final value at once and nothing moves", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".countup").first()).toHaveText("487");
    await expect(page.locator(".countup").first()).toHaveAttribute("data-state", "done");
    const mark = page.locator(".clock-mark").first();
    expect(await mark.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    // A first load paints at once; a page change still fades, gently.
    const main = page.locator(".page-in").first();
    expect(await main.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await page.getByRole("link", { name: "Open the portal" }).click();
    await expect(page).toHaveURL(/\/portal/);
    expect(await page.locator(".page-in").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("fade-in");
  });
});

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("KPIs count up to the real value, once per page load", async ({ page }) => {
    await page.goto("/");
    const first = page.locator(".countup").first();
    // The real value never counts: only data-n, drawn by CSS, moves.
    await expect(first).toHaveText("487");
    await expect(first).toHaveAttribute("data-state", "done");
    await expect(first).toHaveText("487");
    await expect(first).toHaveAttribute("data-n", "487");
    // Client-side back to the front door: already counted, so it's done at once.
    await page.getByRole("link", { name: "Open the portal" }).click();
    await page.getByRole("link", { name: /ziplime/ }).first().click();
    await expect(page.locator(".countup").first()).toHaveAttribute("data-state", "done");
  });

  test("a first load paints at once, without the fade", async ({ page }) => {
    // The fade marks a page change. On a first load it only delayed the first full
    // paint behind script evaluation (Lighthouse's largest paint, 15 Oct 2026).
    await page.goto("/ops");
    expect(await page.locator(".page-in").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  });

  test("page changes fade in, and finish within 250 ms", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Open the portal" }).click();
    await expect(page).toHaveURL(/\/portal/);
    expect(await page.locator(".page-in").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("page-in");
    const d = await page.locator(".page-in").first().evaluate((el) => {
      const s = getComputedStyle(el);
      return parseFloat(s.animationDuration) * (s.animationDuration.endsWith("ms") ? 1 : 1000);
    });
    expect(d).toBeLessThanOrEqual(250);
  });
});

// Screen readers, link previews and copied text must read each number once:
// "487" and "5 of 10", never "487487487" or "555of 10".
test.describe("page text", () => {
  const once = (text: string, s: string) => text.split(s).length - 1;

  test("the server HTML has each number once", async ({ request }) => {
    const html = await (await request.get("/")).text();
    const dl = html.match(/<dl[\s\S]*?<\/dl>/)?.[0] ?? "";
    const text = dl.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");
    expect(once(text, "487")).toBe(1);
    expect(text).toContain("5 of 10");
    expect(text).not.toContain("487487");
  });

  for (const motion of ["no-preference", "reduce"] as const) {
    test(`the page text reads 487 and 5 of 10 (${motion})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: motion });
      await page.goto("/");
      // Check while the count may still be running, and again after.
      for (const state of ["any", "done"]) {
        if (state === "done") await expect(page.locator(".countup").first()).toHaveAttribute("data-state", "done");
        const text = await page.locator("main").innerText();
        expect(once(text, "487")).toBe(1);
        expect(text).toMatch(/(^|\s)487(\s|$)/);
        expect(text).toContain("5 of 10");
        const kpis = await page.locator("dl").first().textContent();
        expect(once(kpis ?? "", "487")).toBe(1);
        await expect(page.getByText("487", { exact: true })).toHaveCount(1);
      }
    });
  }
});
