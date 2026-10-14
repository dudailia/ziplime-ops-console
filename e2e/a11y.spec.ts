import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// axe over every page in both themes. Added in the 14 Oct 2026 audit, which
// found an unlabelled file input, a sideways-scrolling clock the keyboard
// couldn't reach, and top bars outside any landmark.
const PAGES = ["/", "/portal", "/ops", "/ops/accounts/wen-li", "/ops/intake", "/ops/inbox", "/ops/automations", "/about"];

for (const theme of ["dark", "light"] as const) {
  test(`no axe violations on any page, ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript((t) => {
      try {
        localStorage.setItem("ziplime-ops-console:theme", t);
      } catch {}
    }, theme);
    const found: string[] = [];
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
      for (const v of violations) found.push(`${path} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    }
    expect(found).toEqual([]);
  });
}

test("a dropped file that can't be loaded says why", async ({ page }) => {
  await page.goto("/portal");
  const big = "x".repeat(10 * 1024 * 1024 + 1);
  const drop = await page.evaluateHandle((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], "huge.jsonl", { type: "application/x-ndjson" }));
    return dt;
  }, big);
  const zone = page.locator("main h1").first();
  await zone.dispatchEvent("dragover", { dataTransfer: drop });
  await zone.dispatchEvent("drop", { dataTransfer: drop });
  await expect(page.getByTestId("drop-error")).toContainText("huge.jsonl is 10.0 MB. The limit is 10 MB.");
});
