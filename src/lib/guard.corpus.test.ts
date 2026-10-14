// The guard against real phrasings, both ways. The first list is advice and
// return promises a reviewer would expect it to catch; before 14 Oct 2026 it
// let 18 of these 21 through. The second half runs the guard over every piece
// of text the console writes itself, which must never trip it.

import { describe, expect, it } from "vitest";
import { otherClients } from "./crm";
import { STATIC_DATASET as ds } from "./data/static";
import { explain } from "./dryrun/explain";
import { guard, type GuardCategory } from "./guard";
import { templateReply } from "./inbox";
import { rulesTriage } from "./intake/triage";
import { RULES } from "./automations";
import { fileOf } from "./data/lookup";

const cats = (text: string) => [...new Set(guard(text).hits.map((h) => h.category))];

const CAUGHT: [string, GuardCategory][] = [
  ["You should definitely buy more AAPL.", "advice"],
  ["You should probably sell before earnings.", "advice"],
  ["You might want to buy more shares.", "advice"],
  ["You ought to hold through the quarter.", "advice"],
  ["We recommend buying the dip.", "advice"],
  ["We'd suggest selling TSLA here.", "advice"],
  ["I would advise holding through the quarter.", "advice"],
  ["Consider buying more AMD.", "advice"],
  ["The stock is going to go up.", "advice"],
  ["Prices are likely to rise next week.", "advice"],
  ["NVDA will probably rally.", "advice"],
  ["AAPL looks like a smart buy.", "advice"],
  ["This strategy should earn you 20% a year.", "returns"],
  ["Expect returns of 15% annually.", "returns"],
  ["You'll make 20% per year.", "returns"],
  ["It could make you money.", "returns"],
  ["You will profit from this.", "returns"],
  ["There is zero risk with this setting.", "returns"],
  ["This is a no-risk setup.", "returns"],
  ["You can double your money.", "returns"],
  ["It is a sure thing.", "returns"],
  ["You can't go wrong with this profile.", "returns"],
  ["Other investors saw the same refusal.", "other-clients"],
  ["Many of our clients set this to 50.", "other-clients"],
  ["Our traders usually raise the cap.", "other-clients"],
];

describe("guard: advice and promises in the words people actually use", () => {
  it.each(CAUGHT)("%s", (text, category) => {
    expect(cats(text)).toContain(category);
  });
});

describe("guard: support sentences about settings stay clean", () => {
  it.each([
    "There's no risk the order goes out: a dry run never sends anything.",
    "Setting ZIPLIME_MAX_ORDERS_PER_INVOCATION lower will make the engine refuse sooner.",
    "If the strategy is meant to sell, ZIPLIME_ALLOW_SELL has to be on.",
    "You should set ZIPLIME_ALLOWED_SYMBOLS to include TSLA.",
    "You need to add TSLA to the allowlist.",
    "The refusal rate was 20% over the last 5 sessions.",
    "Your strategy tried to sell 10 shares of MSFT and the engine refused it.",
    "We can't say whether the strategy will work.",
    "The order count is capped at 12 a session.",
    "The engine can't fail open: no quote, no order.",
  ])("%s", (text) => {
    expect(guard(text).hits).toEqual([]);
  });
});

describe("guard: nothing the console writes itself trips it", () => {
  it("built-in explanations of every refusal and skip in the seed", () => {
    const flagged: string[] = [];
    for (const d of ds.deployments) {
      const profile = { riskEnv: d.riskEnv, validateOrders: d.validateOrders };
      for (const e of fileOf(ds, d.id).events) {
        if (e.event !== "refuse" && e.event !== "skip") continue;
        const x = explain(e, profile);
        if (!x) continue;
        for (const text of [x.title, x.happened, x.change]) if (guard(text).hits.length) flagged.push(`${d.id} line ${e.line}: ${text}`);
      }
    }
    expect(flagged).toEqual([]);
  });

  it("template replies for every seeded ticket", () => {
    const flagged = ds.tickets
      .map((t) => {
        const account = ds.accounts.find((a) => a.id === t.accountId)!;
        const text = templateReply(ds, t, account);
        return { id: t.id, hits: guard(text, { otherClients: otherClients(account.id, ds.accounts) }).hits };
      })
      .filter((r) => r.hits.length);
    expect(flagged).toEqual([]);
  });

  it("seeded drafts, rules triage welcome emails and the rule descriptions", () => {
    const flagged: string[] = [];
    // T-1043's draft is the tour's example of a draft the guard blocks (tour.test.ts, step 3).
    for (const t of ds.tickets) {
      if (t.id === "T-1043") continue;
      if (t.draft && guard(t.draft.text, { otherClients: otherClients(t.accountId, ds.accounts) }).hits.length) flagged.push(`draft ${t.id}`);
    }
    for (const s of ds.signups) {
      const { email } = rulesTriage(s);
      const others = ds.signups.filter((o) => o.id !== s.id).map((o) => o.email);
      if (guard(`${email.subject}\n${email.body}`, { intake: true, otherClients: others }).hits.length) flagged.push(`welcome ${s.id}`);
    }
    for (const r of RULES) if (guard(`${r.name}. ${r.when} ${r.then}`).hits.length) flagged.push(`rule ${r.id}`);
    expect(flagged).toEqual([]);
  });
});
