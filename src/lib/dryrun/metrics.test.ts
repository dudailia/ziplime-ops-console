import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { netShares, readiness, sideOf, whyGroups, worstEvent } from "./metrics";
import { parseDryRun } from "./parse";

const seed = (id: string) =>
  parseDryRun(readFileSync(new URL(`../../../data/seed/dryruns/${id}.jsonl`, import.meta.url), "utf8"), id);
const manifest = JSON.parse(readFileSync(new URL("../../../data/seed/manifest.json", import.meta.url), "utf8"));
const profileOf = (id: string) => {
  const d = manifest.deployments.find((x: { id: string }) => x.id === id);
  return { riskEnv: d.riskEnv, validateOrders: d.validateOrders };
};

const line = (o: Record<string, unknown>) => JSON.stringify(o);
const place = (id: string, symbol: string, side: "buy" | "sell", qty: number, minute = "10:00") =>
  line({
    account: "LX***17", broker_validated: true, client_order_id: id, dry_run_id: `dryrun-${id}`, event: "place",
    limit_price: null, order_dt: `2026-10-12T${minute}:00-04:00`, order_type: "market", quantity: String(qty),
    recorded_at: "2026-10-12T14:00:01+00:00", requested_amount: side === "buy" ? qty : -qty, route: "auto",
    side, symbol, time_in_force: "day", ziplime_order_id: id,
  });
const cancel = (id: string, known = true) =>
  line({ account: "LX***17", dry_run_id: `dryrun-${id}`, event: "cancel", known_order: known, recorded_at: "2026-10-12T15:00:00+00:00", symbol: "AAPL" });

describe("netShares", () => {
  it("sums signed quantities and leaves cancelled orders out of the net", () => {
    const file = parseDryRun(
      [place("a", "AAPL", "buy", 10), place("b", "AAPL", "sell", 4), place("c", "AAPL", "buy", 7), cancel("c"), place("d", "MSFT", "buy", 3), cancel("zz", false)].join("\n") + "\n",
      "f",
    );
    expect(netShares(file.events)).toEqual([
      { symbol: "AAPL", bought: 10, sold: 4, cancelled: 7, net: 6 },
      { symbol: "MSFT", bought: 3, sold: 0, cancelled: 0, net: 3 },
    ]);
  });
});

describe("sideOf and worstEvent", () => {
  it("takes a refusal's side from the sign of its amount", () => {
    const file = seed("wen-rebalance");
    const sell = file.events.find((e) => e.event === "refuse" && e.reason.includes("sell orders"))!;
    expect(sideOf(sell)).toBe("sell");
  });

  it("colours a session by its worst event", () => {
    const s = seed("kofi-rebal").sessions[0];
    expect(worstEvent(s)).toBe("skip");
    expect(worstEvent(seed("harbor-etf-core").sessions[0])).toBe("place");
  });
});

describe("whyGroups", () => {
  it("groups by rule, unknown first, skips last", () => {
    const file = seed("jonas-etf");
    const groups = whyGroups(file.events, profileOf("jonas-etf"));
    expect(groups[0].kind).toBe("refusal");
    expect(groups[0].explanation?.detailKnown).toBe(false);
    const wen = whyGroups(seed("wen-rebalance").events, profileOf("wen-rebalance"));
    expect(wen[0]).toMatchObject({ ruleId: "sell-disabled", kind: "refusal" });
    expect(wen[0].events).toHaveLength(11);
    expect(wen[wen.length - 1]).toMatchObject({ ruleId: "skip-lot", kind: "benign" });
  });
});

describe("readiness", () => {
  it("passes every check for the clean Harbor Lane momentum run", () => {
    const checks = readiness(seed("harbor-momentum"), profileOf("harbor-momentum"));
    expect(checks.filter((c) => !c.pass)).toEqual([]);
    expect(checks).toHaveLength(6);
  });

  it("fails the validate_order check for a run with validate_orders=False", () => {
    const checks = readiness(seed("aaron-trend"), profileOf("aaron-trend"));
    const failed = checks.filter((c) => !c.pass).map((c) => c.id);
    expect(failed).toContain("validated");
    expect(checks.find((c) => c.id === "validated")?.evidence).toMatch(/broker_validated: false/);
  });

  it("fails the allowlist check and names the symbols", () => {
    const c = readiness(seed("priya-growth"), profileOf("priya-growth")).find((x) => x.id === "allowlist")!;
    expect(c.pass).toBe(false);
    expect(c.evidence).toMatch(/TSLA/);
  });

  it("flags a placed symbol outside the allowlist even without a refusal", () => {
    const file = parseDryRun(place("a", "NVDA", "buy", 1) + "\n", "f");
    const c = readiness(file, { validateOrders: true, riskEnv: { ZIPLIME_ALLOWED_SYMBOLS: "AAPL" } }, 1).find((x) => x.id === "allowlist")!;
    expect(c.pass).toBe(false);
  });

  it("fails on too few sessions and on malformed lines, with the line numbers", () => {
    const file = parseDryRun(place("a", "AAPL", "buy", 1) + "\n{oops\n", "f");
    const checks = readiness(file, null, 3);
    expect(checks.find((c) => c.id === "sessions")?.pass).toBe(false);
    expect(checks.find((c) => c.id === "clean-file")).toMatchObject({ pass: false, evidence: "1 malformed line: 2." });
  });

  it("checks stability against the median, at the 30% boundary", () => {
    const sessions = (counts: number[]) =>
      counts
        .flatMap((n, day) => Array.from({ length: n }, (_, i) => place(`d${day}o${i}`, "AAPL", "buy", 1).replace(/2026-10-12T/, `2026-10-0${day + 5}T`)))
        .join("\n") + "\n";
    expect(readiness(parseDryRun(sessions([10, 13, 10]), "f"), null, 3).find((c) => c.id === "stable")?.pass).toBe(true);
    expect(readiness(parseDryRun(sessions([10, 14, 10]), "f"), null, 3).find((c) => c.id === "stable")?.pass).toBe(false);
  });
});

describe("readiness and health share one window", async () => {
  const { HEALTH_WINDOW } = await import("../health");
  const { RECENT_SESSIONS } = await import("./metrics");

  it("uses the last 5 sessions for both", () => {
    expect(RECENT_SESSIONS).toBe(5);
    expect(HEALTH_WINDOW).toBe(RECENT_SESSIONS);
    expect(readiness(seed("harbor-momentum"), profileOf("harbor-momentum")).find((c) => c.id === "sessions")?.label).toBe(
      "At least 5 sessions recorded",
    );
  });

  it("fails Jonas Weber's breakout on recent refusals, as the CRM does", () => {
    const c = readiness(seed("jonas-breakout"), profileOf("jonas-breakout")).find((x) => x.id === "no-refusals")!;
    expect(c.pass).toBe(false);
    expect(c.evidence).toMatch(/2026-10-07/);
  });
});
