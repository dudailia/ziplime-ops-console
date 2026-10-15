// Retakes docs/screenshots against a running console.
//
//   node scripts/screenshots.mjs static http://localhost:3311
//   node scripts/screenshots.mjs db http://localhost:3300 <OPS_PASSWORD>
//
// "static" is the public demo: every page in night and day, at 1440 px and
// 390 px, the tour, and the link preview. "db" needs a fresh database-mode dev
// server (DATABASE_URL=pglite:<new dir>): it approves a signup, sends a signed
// batch with one broken line, and shoots the onboarding key and the Ingest
// panel. Reduced motion, so every shot is the final state.
//
//   SHOTS_ONLY=about node scripts/screenshots.mjs static http://localhost:3311
//
// retakes only the pages named (comma-separated), and skips the tour and link preview.

import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs/screenshots");
const [, , mode, base, password] = process.argv;
if (!["static", "db"].includes(mode) || !base) {
  console.error("usage: node scripts/screenshots.mjs static|db <base url> [OPS_PASSWORD]");
  process.exit(2);
}

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const PAGES = {
  front: "/",
  portal: "/portal",
  accounts: "/ops",
  account: "/ops/accounts/jonas-weber",
  intake: "/ops/intake",
  inbox: "/ops/inbox",
  automations: "/ops/automations",
  about: "/about",
};

const ONLY = process.env.SHOTS_ONLY ? new Set(process.env.SHOTS_ONLY.split(",")) : null;
// The /about shots open on the latest section, not the top of the page.
const ANCHOR = { about: "A second review, 14 Oct 2026" };

const browser = await chromium.launch();
const problems = [];

async function context(theme, viewport) {
  const ctx = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: "dark",
    ...(password ? { httpCredentials: { username: "ops", password } } : {}),
  });
  if (theme === "light") await ctx.addInitScript(() => localStorage.setItem("ziplime-ops-console:theme", "light"));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`${page.url()}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`${page.url()}: ${m.text()}`));
  return { ctx, page };
}

async function settle(page) {
  await page.waitForLoadState("networkidle");
  // Database mode runs on next dev; its indicator badge isn't part of the console.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

async function shoot(page, name) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (overflow > 0) problems.push(`${name}: scrolls sideways by ${overflow}px`);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

const suffix = (theme, viewport) => `${viewport === "phone" ? "-phone" : ""}-${theme}`;

if (mode === "static") {
  for (const theme of ["dark", "light"]) {
    for (const viewport of ["desktop", "phone"]) {
      const { ctx, page } = await context(theme, viewport);
      for (const [name, path] of Object.entries(PAGES)) {
        if (ONLY && !ONLY.has(name)) continue;
        await page.goto(base + path);
        await settle(page);
        if (ANCHOR[name]) await page.getByRole("heading", { name: ANCHOR[name] }).evaluate((el) => el.scrollIntoView({ block: "start" }));
        await shoot(page, `${name}${suffix(theme, viewport)}`);
      }
      if (ONLY) {
        await ctx.close();
        continue;
      }
      // The tour's first three steps.
      await page.goto(base + "/");
      await settle(page);
      await page.getByTestId("tour-start").click();
      for (const [step, name] of [[1, "refusal"], [2, "watch"], [3, "guard"]]) {
        if (step > 1) await page.keyboard.press("ArrowRight");
        await page.getByRole("dialog").filter({ hasText: `Step ${step} of 5` }).waitFor();
        await settle(page);
        await page.waitForTimeout(700); // the spotlight's scroll
        await shoot(page, `tour-${name}${suffix(theme, viewport)}`);
      }
      await page.keyboard.press("Escape");
      await ctx.close();
    }
  }
  if (!ONLY) {
    const og = await fetch(`${base}/opengraph-image`);
    writeFileSync(join(OUT, "og.png"), Buffer.from(await og.arrayBuffer()));
    console.log("  og.png");
  }
} else {
  // Database mode: approve Maya Chen's signup and keep the key it shows once.
  const { ctx, page } = await context("dark", "desktop");
  await page.goto(`${base}/ops/intake?id=su-001`);
  await settle(page);
  await page.getByRole("button", { name: "Approve and create account" }).click();
  const setup = page.getByTestId("ingest-setup");
  await setup.waitFor();
  await settle(page);
  await setup.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(250);
  await shoot(page, "onboarding-key-dark");
  const secret = Buffer.from((await setup.locator("pre").first().textContent()).trim(), "hex");
  const deployment = (await setup.locator("p code").first().textContent()).trim();
  await ctx.close();

  // Two signed batches, the way the forwarder sends them: a real file, then a broken line.
  const lines = readFileSync(join(ROOT, "data/seed/dryruns/greta-sector.jsonl"), "utf8").split("\n").filter(Boolean);
  const send = async (first_line, batch) => {
    const body = JSON.stringify({ file: "greta-sector.jsonl", first_line, lines: batch });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = `v1=${createHmac("sha256", secret).update(`${ts}.`).update(body).digest("hex")}`;
    const res = await fetch(`${base}/api/ingest/${deployment}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ziplime-timestamp": ts, "x-ziplime-signature": sig },
      body,
    });
    if (!res.ok) throw new Error(`ingest ${res.status}: ${await res.text()}`);
  };
  await send(1, lines);
  await send(lines.length + 1, ['{"event": "place", broken']);

  for (const [theme, viewport] of [["dark", "desktop"], ["light", "desktop"], ["dark", "phone"]]) {
    const { ctx: c, page: p } = await context(theme, viewport);
    await p.goto(`${base}/ops/accounts/intake-maya-chen`);
    await settle(p);
    await p.getByTestId(`ingest-${deployment}`).evaluate((el) => el.scrollIntoView({ block: "center" }));
    await p.waitForTimeout(250);
    await shoot(p, `account-ingest${suffix(theme, viewport)}`);
    await c.close();
  }
}

await browser.close();
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.join("\n")}`);
  process.exit(1);
}
