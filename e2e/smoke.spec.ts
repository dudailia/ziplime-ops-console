import { expect, test } from "@playwright/test";

test("portal, upload, CRM, intake, inbox and rules work end to end without an API key", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Every page carries the sample band and the footer.
  await page.goto("/");
  await expect(page.getByText("Sample data. Fictional accounts.")).toBeVisible();
  await expect(page.getByText("Unofficial concept built on the open-source")).toBeVisible();

  // Portal: a seeded deployment, a refusal and its explanation.
  await page.goto("/portal?d=priya-growth&s=2026-10-12");
  await expect(page.getByRole("heading", { name: "Mon 12 Oct 2026" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Why didn't these orders go out?" })).toBeVisible();
  await page.locator("[data-line]").filter({ hasText: "TSLA isn't on the allowlist" }).first().getByRole("button").click();
  await expect(page.getByText("ZIPLIME_ALLOWED_SYMBOLS doesn't include it")).toBeVisible();

  // The unexplained broker message offers Claude, which is off.
  await page.goto("/portal?d=jonas-etf&s=2026-10-09");
  await page.locator("[data-line]").filter({ hasText: "Lime rejected it in pre-trade validation" }).first().getByRole("button").click();
  await expect(page.getByText("AI drafting is off.").first()).toBeVisible();

  // Upload: a malformed line is reported by number and the rest loads.
  const good = (id: string) =>
    JSON.stringify({ account: "LX***99", broker_validated: true, client_order_id: id, dry_run_id: `dryrun-${id}`, event: "place", limit_price: null, order_dt: "2026-10-12T10:00:00-04:00", order_type: "market", quantity: "5", recorded_at: "2026-10-12T14:00:01+00:00", requested_amount: 5, route: "auto", side: "buy", symbol: "AAPL", time_in_force: "day", ziplime_order_id: id });
  await page.getByTestId("upload-input").setInputFiles({
    name: "mine.jsonl",
    mimeType: "application/x-ndjson",
    buffer: Buffer.from([good("a"), good("b"), '{"event": "place"', good("d")].join("\n") + "\n"),
  });
  await expect(page.getByText("1 line couldn't be read. The other 3 loaded.")).toBeVisible();
  await expect(page.getByText("Line 3:")).toBeVisible();

  // CRM: ten accounts with health in words.
  await page.goto("/ops");
  await expect(page.getByRole("link", { name: "Wen Li" })).toBeVisible();
  await expect(page.getByText("Needs help").first()).toBeVisible();

  // Intake: approve a signup, and it becomes a CRM account.
  await page.goto("/ops/intake?id=su-001");
  await page.getByRole("button", { name: "Approve and create account" }).click();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Open the new account" }).click();
  await expect(page.getByRole("heading", { name: "Maya Chen" })).toBeVisible();

  // Inbox: a flagged draft can't be approved; a template reply can.
  await page.goto("/ops/inbox?t=T-1043");
  await expect(page.getByText("Guard blocked approval.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve and send" })).toBeDisabled();
  await page.getByRole("button", { name: "Insert template reply" }).click();
  await expect(page.getByText("Guard: nothing found.")).toBeVisible();
  await page.getByRole("button", { name: "Approve and send" }).click();
  await expect(page.getByText("Approved by Demo reviewer, marked as sent")).toBeVisible();

  // Rules: a run opens Wen Li's ticket; a second run only skips.
  await page.goto("/ops/automations");
  await page.getByRole("button", { name: "Run rules now" }).click();
  await expect(page.getByText(/Opened ticket A-wen-rebalance-streak/)).toBeVisible();
  await page.getByRole("button", { name: "Run rules now" }).click();
  await expect(page.getByText(/Run finished: nothing new/)).toBeVisible();

  // State survives a reload, and Reset demo clears it.
  await page.reload();
  await expect(page.getByText("2 runs, newest first")).toBeVisible();
  const reset = page.getByRole("button", { name: "Reset demo" }).filter({ visible: true }).first();
  await reset.click();
  await page.getByRole("button", { name: "Reset", exact: true }).filter({ visible: true }).first().click();
  await expect(page.getByText("No runs yet.")).toBeVisible();

  expect(errors).toEqual([]);
});

test("no page scrolls sideways", async ({ page }) => {
  for (const path of ["/", "/portal", "/ops", "/ops/accounts/wen-li", "/ops/intake", "/ops/inbox", "/ops/automations"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
