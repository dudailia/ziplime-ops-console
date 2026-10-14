import { expect, test } from "@playwright/test";

// The ziplime look on the front door (DESIGN.md): night by default, the hero
// terminal, the ticker, the fonts, and the reduced-motion final state.

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

// One "paused" applies to both of the ticker's animations.
const PAUSED = /^paused(, paused)*$/;

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("the terminal types the real engine line, then the explanation, and replays", async ({ page }) => {
    await page.goto("/");
    const term = page.locator(".terminal");
    // The whole line is in the DOM from the start, once, while it types.
    const raw = await term.locator("[data-speed=engine]").getAttribute("data-type");
    expect(raw).toContain('"symbol": "TSLA"');
    expect(await term.textContent()).toContain(raw);
    const height = await term.evaluate((el) => el.getBoundingClientRect().height);
    await expect(term).toHaveAttribute("data-state", "done", { timeout: 10_000 });
    expect(await term.evaluate((el) => el.getBoundingClientRect().height)).toBe(height);
    await expect(term).toContainText("TSLA isn't on the allowlist");

    await term.getByRole("button", { name: "Replay" }).click();
    await expect(term).toHaveAttribute("data-state", "typing");
    expect(await term.textContent()).toContain(raw);
    await expect(term).toHaveAttribute("data-state", "done", { timeout: 10_000 });
  });

  test("the ticker scrolls real events and pauses on hover and with its button", async ({ page }) => {
    await page.goto("/");
    const track = page.locator(".ticker-track");
    await expect(track).toHaveAttribute("data-run", "true");
    await expect(track.locator("li")).toHaveCount(32);
    const state = () => track.evaluate((el) => getComputedStyle(el).animationPlayState);
    expect(await state()).toContain("running");
    await page.locator(".ticker-strip").hover();
    expect(await state()).toMatch(PAUSED);
    await page.mouse.move(0, 600);
    await page.getByRole("button", { name: "Pause the ticker" }).click();
    await page.mouse.move(0, 600);
    expect(await state()).toMatch(PAUSED);
    await page.getByRole("button", { name: "Play the ticker" }).click();
    await page.mouse.move(0, 600);
    expect(await state()).toContain("running");
    // Keyboard focus pauses it too.
    await page.locator(".ticker-strip").focus();
    expect(await state()).toMatch(PAUSED);
  });
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("no typing, no scrolling ticker, no flicker: just the final state", async ({ page }) => {
    await page.goto("/");
    const term = page.locator(".terminal");
    await expect(term).toHaveAttribute("data-state", "done");
    await expect(term.locator("[data-rest]").first()).toHaveText("");
    await expect(term.getByRole("button", { name: "Replay" })).toBeHidden();
    const anim = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).animationName);
    expect(await anim(".ticker-track")).toBe("none");
    expect(await anim(".flicker")).toBe("none");
    await expect(page.getByRole("button", { name: "Pause the ticker" })).toBeHidden();
  });
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
