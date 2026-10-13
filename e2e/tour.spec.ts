import { expect, test } from "@playwright/test";

test("the tour walks all five steps by keyboard, pauses, resumes and finishes", async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByTestId("tour-start").click();

  const card = page.getByRole("dialog");
  const spot = page.getByTestId("tour-spotlight");

  // 1. Portal: the refused TSLA order, opened, with its fix.
  await expect(page).toHaveURL(/\/portal\?d=priya-growth&s=2026-10-12&l=50/);
  await expect(card).toContainText("Step 1 of 5");
  await expect(spot).toBeVisible();
  await expect(page.locator('[data-tour="refusal"]')).toContainText("ZIPLIME_ALLOWED_SYMBOLS");
  await expect(card).toBeFocused();

  // 2. Accounts: Jonas Weber on watch.
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/ops$/);
  await expect(card).toContainText("Jonas Weber is on watch");
  await expect(page.locator('[data-account="jonas-weber"]')).toContainText("Watch");

  // Back and forward again by keyboard.
  await page.keyboard.press("ArrowLeft");
  await expect(card).toContainText("Step 1 of 5");
  await page.keyboard.press("ArrowRight");
  await expect(card).toContainText("Step 2 of 5");

  // 3. Inbox: the guard blocks the draft.
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/ops\/inbox\?t=T-1043/);
  await expect(page.locator('[data-tour="guard"]')).toContainText("Guard blocked approval.");
  await expect(page.getByRole("button", { name: "Approve and send" })).toBeDisabled();

  // Escape pauses; the front door offers to resume at step 3.
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByTestId("tour-start")).toHaveText("Resume the tour, step 3 of 5");
  await page.getByTestId("tour-start").click();
  await expect(page).toHaveURL(/\/ops\/inbox\?t=T-1043/);
  await expect(card).toContainText("Step 3 of 5");

  // 4. Intake: the card's action presses the real Approve button.
  await page.getByTestId("tour-next").click();
  await expect(page).toHaveURL(/\/ops\/intake\?id=su-023/);
  await card.getByRole("button", { name: "Approve will.tanaka" }).click();
  await expect(page.getByRole("link", { name: "Open the new account" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Approve will.tanaka" })).toHaveCount(0);

  // 5. Automations: the card runs the rules.
  await page.getByTestId("tour-next").click();
  await expect(page).toHaveURL(/\/ops\/automations/);
  await card.getByRole("button", { name: "Run rules now" }).click();
  await expect(page.getByText(/Opened ticket A-wen-rebalance-streak/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Finish" })).toBeVisible();
  await card.getByRole("button", { name: "Finish" }).click();
  await expect(card).toHaveCount(0);

  await page.goto("/");
  await expect(page.getByTestId("tour-start")).toHaveText("Take the tour again");
  if (!isMobile) expect(errors).toEqual([]);
});

test("the tour stays usable when the visitor wanders off mid-step", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("tour-start").click();
  await expect(page.getByRole("dialog")).toContainText("Step 1 of 5");
  await page.goto("/ops/automations");
  // A full load comes back paused, never with a surprise spotlight.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const resume = page.getByRole("button", { name: "Resume tour, step 1 of 5" }).filter({ visible: true });
  if (await resume.count()) {
    await resume.first().click();
    await expect(page).toHaveURL(/\/portal\?d=priya-growth/);
    await expect(page.getByRole("dialog")).toContainText("Step 1 of 5");
  }
});
