// End to end (PLAN.md 15.8): the real engine writes a dry-run file, a signup
// is approved in the console, the real forwarder sends the file, and the
// console's numbers match the file. Run with: npm run test:ingest

import { execFileSync, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const ROOT = resolve(__dirname, "..");
const WORK = process.env.E2E_WORK_DIR!;
const SEED_PYTHON = resolve(ROOT, "../ziplime/.venv/bin/python");
const SIGNUP = "su-001"; // maya.chen@example.com

type Rec = { event: "place" | "refuse" | "skip" | "cancel"; order_dt?: string | null; recorded_at: string; dry_run_id?: string };
type Counts = Record<Rec["event"], number>;

const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const etDate = (iso: string) => ET.format(new Date(iso));
const zero = (): Counts => ({ place: 0, refuse: 0, skip: 0, cancel: 0 });

/** Counts straight from the file with JSON.parse, without the console's parser. */
function fromFile(text: string) {
  const total = zero();
  const sessions = new Map<string, Counts>();
  const placedOn = new Map<string, string>();
  for (const line of text.split("\n").filter(Boolean)) {
    const r = JSON.parse(line) as Rec;
    // A cancel has no order_dt; it belongs to the session of the order it cancels.
    const date = r.event === "cancel" ? (placedOn.get(r.dry_run_id!) ?? etDate(r.recorded_at)) : etDate(r.order_dt ?? r.recorded_at);
    if (r.event === "place") placedOn.set(r.dry_run_id!, date);
    total[r.event] += 1;
    const s = sessions.get(date) ?? zero();
    s[r.event] += 1;
    sessions.set(date, s);
  }
  return { total, sessions: new Map([...sessions].sort(([a], [b]) => a.localeCompare(b))) };
}

function forwarder(deployment: string, state: string, extra: string[] = []) {
  const run = spawnSync(
    "python3",
    [
      join(ROOT, "forwarder/ziplime_forwarder.py"),
      "--file", join(WORK, "dryruns/greta-sector.jsonl"),
      "--url", `http://localhost:3300/api/ingest/${deployment}`,
      "--secret-file", join(WORK, "key.secret"),
      "--state", join(WORK, state),
      "--once",
      ...extra,
    ],
    { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
  );
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

async function sessionCounts(page: Page, deployment: string, date: string): Promise<Counts> {
  await page.goto(`/portal?d=${deployment}&s=${date}`);
  const dl = page.locator("dl").filter({ hasText: "Refusal rate" });
  await expect(dl).toBeVisible();
  const read = async (word: string) => Number(await dl.locator("div").filter({ hasText: word }).locator("dd .sr-only").first().textContent());
  return { place: await read("Would send"), refuse: await read("Refused"), skip: await read("Skipped"), cancel: await read("Cancelled") };
}

function signed(secret: Buffer, body: string, ts = String(Math.floor(Date.now() / 1000))) {
  const sig = `v1=${createHmac("sha256", secret).update(`${ts}.`).update(body).digest("hex")}`;
  return { "content-type": "application/json", "x-ziplime-timestamp": ts, "x-ziplime-signature": sig };
}

test("a dry-run file goes from the engine through the forwarder into the console, exactly", async ({ page, request }) => {
  // 1. The real seed generator runs the real engine and writes the file. It is
  //    deterministic, so this reproduces the committed greta-sector.jsonl.
  execFileSync(SEED_PYTHON, [join(ROOT, "scripts/generate_seed.py"), "--out", WORK, "--only", "greta-sector"], {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    stdio: "pipe",
  });
  const text = readFileSync(join(WORK, "dryruns/greta-sector.jsonl"), "utf8");
  const want = fromFile(text);
  expect(want.total.place + want.total.refuse).toBeGreaterThan(10);

  // 2. Approve a signup in the console; the key is shown once.
  await page.goto(`/ops/intake?id=${SIGNUP}`);
  await page.getByRole("button", { name: "Approve and create account" }).click();
  const setup = page.getByTestId("ingest-setup");
  await expect(setup).toBeVisible();
  const secret = (await setup.locator("pre").first().textContent())!.trim();
  expect(secret).toMatch(/^[0-9a-f]{64}$/);
  const deployment = (await setup.locator("p code").first().textContent())!.trim();
  expect(deployment).toBe("intake-maya-chen-dryrun");
  await expect(setup.locator("pre").last()).toContainText(`--url http://localhost:3300/api/ingest/${deployment}`);
  expect(JSON.stringify(await page.evaluate(() => ({ ...localStorage })))).not.toContain(secret);
  writeFileSync(join(WORK, "key.secret"), `${secret}\n`);
  chmodSync(join(WORK, "key.secret"), 0o600);

  // 3. The real forwarder sends the file.
  const first = forwarder(deployment, "state.json");
  expect(first.code, first.out).toBe(0);
  expect(first.out).toContain(`Lines 1 to ${want.total.place + want.total.refuse + want.total.skip + want.total.cancel}: ${text.split("\n").filter(Boolean).length} accepted.`);

  // The console's numbers equal the file's: totals on the account page...
  await page.goto("/ops/accounts/intake-maya-chen");
  const card = page.locator("li").filter({ hasText: "First dry run" }).first();
  await expect(card).toContainText(`${want.total.place} sent, ${want.total.refuse} refused, ${want.total.skip} skipped`);
  await expect(card).toContainText(`${want.sessions.size}, last`);
  // ...and every session in the portal.
  for (const [date, counts] of want.sessions) {
    expect(await sessionCounts(page, deployment, date), date).toEqual(counts);
  }

  // 4. A second run sends nothing. A fresh state file resends everything: every line a duplicate.
  const second = forwarder(deployment, "state.json");
  expect(second.code, second.out).toBe(0);
  expect(second.out.trim()).toBe("");
  const fresh = forwarder(deployment, "fresh-state.json", ["--batch-lines", "20"]);
  expect(fresh.code, fresh.out).toBe(0);
  expect(fresh.out).not.toContain("accepted");
  expect(fresh.out).toContain("20 duplicate");
  await page.goto("/ops/accounts/intake-maya-chen");
  await expect(card).toContainText(`${want.total.place} sent, ${want.total.refuse} refused, ${want.total.skip} skipped`);
  const panel = page.getByTestId(`ingest-${deployment}`);
  await expect(panel.locator("li").filter({ hasText: "0 new" })).toHaveCount(3);

  // 5. Refusals and per-line results.
  const key = Buffer.from(secret, "hex");
  const next = text.split("\n").filter(Boolean).length + 1;
  const extra = readFileSync(join(ROOT, "data/seed/dryruns/kofi-rebal.jsonl"), "utf8").split("\n")[0];
  const body = JSON.stringify({ file: "greta-sector.jsonl", first_line: next, lines: ['{"event": "place", broken', extra] });
  const url = `/api/ingest/${deployment}`;

  const tampered = await request.post(url, { data: body, headers: signed(Buffer.alloc(32, 1), body) });
  expect(tampered.status()).toBe(401);
  expect(await tampered.json()).toEqual({ error: "unauthorized" });

  const old = await request.post(url, { data: body, headers: signed(key, body, String(Math.floor(Date.now() / 1000) - 360)) });
  expect(old.status()).toBe(401);
  expect(await old.json()).toEqual({ error: "stale_timestamp" });

  // Navigate inside the app while this lands, to check pages don't show stale numbers.
  await page.goto("/ops");
  const mixed = await request.post(url, { data: body, headers: signed(key, body) });
  expect(mixed.status()).toBe(200);
  const result = await mixed.json();
  expect(result.results[0]).toMatchObject({ line: next, status: "rejected" });
  expect(result.results[0].reason).toMatch(/^Not valid JSON/);
  expect(result.results[1]).toEqual({ line: next + 1, status: "accepted" });

  // 6. Client-side navigation shows the new line without a reload.
  await page.locator('[data-account="intake-maya-chen"] a').first().click();
  await expect(page).toHaveURL(/\/ops\/accounts\/intake-maya-chen$/);
  const kind = (JSON.parse(extra) as Rec).event;
  const after = { ...want.total, [kind]: want.total[kind] + 1 };
  await expect(card).toContainText(`${after.place} sent, ${after.refuse} refused, ${after.skip} skipped`);
  await expect(panel).toContainText(`Line ${next}: Not valid JSON`);

  // 7. Nothing touched the committed seed.
  expect(execFileSync("git", ["status", "--porcelain", "data/seed"], { cwd: ROOT, encoding: "utf8" })).toBe("");
});

test("without credentials the console stays closed, and the webhook stays signed-only", async ({ browser }) => {
  const anon = await browser.newContext({ httpCredentials: undefined });
  const r = await anon.request.get("http://localhost:3300/portal");
  expect(r.status()).toBe(401);
  expect(r.headers()["www-authenticate"]).toContain("Basic");
  const cross = await anon.request.post("http://localhost:3300/api/ops/signups/su-002/approve", {
    data: { subject: "x", body: "y" },
    headers: {
      authorization: `Basic ${Buffer.from(`e2e:${process.env.E2E_OPS_PASSWORD}`).toString("base64")}`,
      origin: "http://evil.example",
    },
  });
  expect(cross.status()).toBe(403);
  await anon.close();
});
