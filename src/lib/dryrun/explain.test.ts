import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explain, needsClaude, splitReason } from "./explain";
import { parseDryRun } from "./parse";
import type { RefuseEvent, SkipEvent } from "./types";

const DIR = new URL("../../../data/seed/dryruns/", import.meta.url);
const seedReasons = readdirSync(DIR)
  .flatMap((f) => parseDryRun(readFileSync(new URL(f, DIR), "utf8"), f).events)
  .filter((e): e is RefuseEvent | SkipEvent => e.event === "refuse" || e.event === "skip");

const refuse = (reason: string, over: Partial<RefuseEvent> = {}): RefuseEvent => ({
  event: "refuse",
  line: 1,
  raw: "",
  recorded_at: "2026-10-12T14:00:00+00:00",
  account: "LX***17",
  extra: {},
  clock: { session: "2026-10-12", minuteET: 600, source: "order_dt" },
  ziplime_order_id: "o1",
  order_dt: "2026-10-12T10:00:00-04:00",
  symbol: "AAPL",
  requested_amount: 40,
  reason,
  ...over,
});

const profile = {
  validateOrders: true,
  riskEnv: {
    ZIPLIME_ALLOWED_SYMBOLS: "AAPL,MSFT",
    ZIPLIME_MAX_ORDER_QUANTITY: "30",
    ZIPLIME_MAX_ORDER_NOTIONAL_USD: "9000",
    ZIPLIME_MAX_ORDERS_PER_INVOCATION: "6",
  },
};

describe("explain, on every reason the seed run produced", () => {
  it("explains every seed reason except the one unrecognised broker message", () => {
    const unexplained = seedReasons.filter((e) => needsClaude(explain(e)));
    expect(unexplained.map((e) => e.reason)).toEqual([
      "ValueError: Lime rejected order during validation: price is outside the allowed band for this symbol",
    ]);
  });

  const cases: [string, string][] = [
    ["ValueError: Lime order symbol 'TSLA' is not allowlisted", "allowlist"],
    ["ValueError: Lime order quantity exceeds the configured risk limit", "max-quantity"],
    ["ValueError: Lime sell orders are disabled by the configured risk limits", "sell-disabled"],
    ["ValueError: Lime order notional exceeds the configured risk limit", "notional"],
    ["ValueError: Lime market order notional exceeds the configured risk limit", "market-notional"],
    ["ValueError: Lime returned no current quote for 'GOOGL'; a market order cannot be bounded without one", "no-quote"],
    ["ValueError: Lime order count exceeds the per-invocation risk limit", "max-orders"],
    ["RuntimeError: Lime order deadline expired before broker submission", "deadline"],
    ["ValueError: Lime rejected order during validation: insufficient buying power", "broker-validation"],
  ];
  it.each(cases)("%s -> %s", (reason, ruleId) => {
    expect(seedReasons.some((e) => e.reason === reason)).toBe(true);
    expect(explain(refuse(reason))?.ruleId).toBe(ruleId);
  });

  it("calls a skip benign and reads the fraction from it", () => {
    const skip = seedReasons.find((e) => e.event === "skip")!;
    const x = explain(skip);
    expect(x).toMatchObject({ ruleId: "skip-lot", kind: "benign", detailKnown: true });
    expect(x?.happened).toContain(skip.symbol);
  });

  // The engine formats the fraction with Python's :g, which switches to an
  // exponent below 1e-4. Float noise left by a rebalance is exactly that small.
  it.each([
    ["0.316 VTI is below one lot (1 share); order not sent", "0.316 VTI"],
    ["4e-05 AAPL is below one lot (1 share); order not sent", "less than 0.0001 AAPL"],
    ["2.27374e-13 SPY is below one lot (1 share); order not sent", "less than 0.0001 SPY"],
  ])("reads the skip %s", (reason, asked) => {
    const skip = seedReasons.find((e) => e.event === "skip")! as SkipEvent;
    const x = explain({ ...skip, reason });
    expect(x).toMatchObject({ ruleId: "skip-lot", kind: "benign" });
    expect(x?.happened).toContain(`asked for ${asked}.`);
    expect(needsClaude(x)).toBe(false);
  });
});

describe("explain, on engine messages the seed doesn't produce", () => {
  it.each([
    ["ValueError: Lime order quantity must be positive and finite", "bad-quantity"],
    ["ValueError: Lime order quantity must be non-zero.", "bad-quantity"],
    ["ValueError: Lime limit price must be positive and finite", "bad-limit"],
    ["ValueError: Lime supports MarketOrder and LimitOrder only; got StopOrder", "order-style"],
    ["ValueError: Lime Trader SDK supports MarketOrder and LimitOrder only; got StopLimitOrder.", "order-style"],
    ["ValueError: Lime quote for 'AMZN' carries no usable price", "no-quote"],
    ["RuntimeError: invalid ZIPLIME_ORDER_DEADLINE_UTC", "deadline-config"],
    ["RuntimeError: ZIPLIME_ORDER_DEADLINE_UTC must include a timezone", "deadline-config"],
    ["ValueError: Lime account 'LX-1' is not available to these credentials.", "account"],
    ["ValueError: Several Lime accounts are available. Set job-spec account_id or LIME_SDK_ACCOUNT_ID explicitly; automatic selection is disabled for safety.", "account"],
    ["RuntimeError: Lime returned no brokerage accounts for these credentials.", "account"],
    ["ValueError: Lime position/order symbol 'ZZZ' is absent from assets.sqlite. Add it with its listing MIC (tried: XNAS).", "asset-missing"],
  ])("%s -> %s", (reason, ruleId) => {
    expect(explain(refuse(reason))?.ruleId).toBe(ruleId);
  });
});

describe("explain, edges", () => {
  it("returns null for a reason no rule knows", () => {
    expect(explain(refuse("ConnectionError: Lime API timed out"))).toBeNull();
    expect(needsClaude(null)).toBe(true);
  });

  it("knows the broker-validation rule but not every broker message", () => {
    const x = explain(refuse("ValueError: Lime rejected order during validation: price is outside the allowed band for this symbol"));
    expect(x).toMatchObject({ ruleId: "broker-validation", detailKnown: false });
    expect(needsClaude(x)).toBe(true);
  });

  it("anchors patterns: market-notional doesn't also count as notional, and a prefix isn't enough", () => {
    expect(explain(refuse("ValueError: Lime market order notional exceeds the configured risk limit"))?.ruleId).toBe("market-notional");
    expect(explain(refuse("ValueError: Lime order notional exceeds the configured risk limit"))?.ruleId).toBe("notional");
    expect(explain(refuse("ValueError: Lime order notional exceeds the configured risk limit, twice"))).toBeNull();
    expect(explain(refuse("ValueError: Note: Lime order symbol 'X' is not allowlisted"))).toBeNull();
  });

  it("uses the risk profile when it's known", () => {
    expect(explain(refuse("ValueError: Lime order symbol 'TSLA' is not allowlisted", { symbol: "TSLA" }), profile)?.happened).toContain(
      "it allows AAPL, MSFT",
    );
    expect(explain(refuse("ValueError: Lime order quantity exceeds the configured risk limit"), profile)?.happened).toBe(
      "The order asked for 40 shares, and the limit is 30.",
    );
    expect(explain(refuse("ValueError: Lime market order notional exceeds the configured risk limit", { requested_amount: -5 }), profile)?.happened).toContain(
      "at the bid",
    );
  });

  it("tells the truth about sells under the fail-closed profile", () => {
    const x = explain(refuse("ValueError: Lime sell orders are disabled by the configured risk limits", { requested_amount: -20 }));
    expect(x?.happened).toContain("refuses to start if ZIPLIME_ALLOW_SELL=true");
    expect(x?.change).toContain("not an option under this profile");
  });

  it("splits the exception type from the message", () => {
    expect(splitReason("ValueError: a: b")).toEqual({ type: "ValueError", message: "a: b" });
    expect(splitReason("no type here")).toEqual({ type: null, message: "no type here" });
  });
});
