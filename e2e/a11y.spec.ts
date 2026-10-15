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

test("loading a good file after a failed drop clears the drop error", async ({ page }) => {
  // Pre-ship review, 14 Oct: the "Open a .jsonl file" button sits inside the drop zone,
  // so the stale alert stayed above the newly loaded file.
  await page.goto("/portal");
  const drop = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x".repeat(10 * 1024 * 1024 + 1)], "huge.jsonl", { type: "application/x-ndjson" }));
    return dt;
  });
  const zone = page.locator("main h1").first();
  await zone.dispatchEvent("dragover", { dataTransfer: drop });
  await zone.dispatchEvent("drop", { dataTransfer: drop });
  await expect(page.getByTestId("drop-error")).toBeVisible();

  const line = JSON.stringify({ account: "LX***99", broker_validated: true, client_order_id: "a", dry_run_id: "dryrun-a", event: "place", limit_price: null, order_dt: "2026-10-12T10:00:00-04:00", order_type: "market", quantity: "5", recorded_at: "2026-10-12T14:00:01+00:00", requested_amount: 5, route: "auto", side: "buy", symbol: "AAPL", time_in_force: "day", ziplime_order_id: "a" });
  await page.getByTestId("upload-input").setInputFiles({ name: "mine.jsonl", mimeType: "application/x-ndjson", buffer: Buffer.from([line, '{"event": "place"'].join("\n") + "\n") });
  await expect(page.getByText("1 line couldn't be read. The other 1 loaded.")).toBeVisible();
  await expect(page.getByTestId("drop-error")).toHaveCount(0);
});
