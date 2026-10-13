// Why an order didn't go out, from the reason string the engine wrote.
// Every message below is copied from lime_trader_sdk_exchange.py
// (feat/dry-run-orders). Deterministic, no network. A reason that matches
// nothing returns null, and the UI offers Claude for that one only.

import type { RefuseEvent, SkipEvent } from "./types";
import type { RiskEnv } from "../seed";

export type RuleId =
  | "allowlist"
  | "bad-quantity"
  | "max-quantity"
  | "sell-disabled"
  | "bad-limit"
  | "notional"
  | "market-notional"
  | "order-style"
  | "max-orders"
  | "no-quote"
  | "deadline"
  | "deadline-config"
  | "broker-validation"
  | "account"
  | "asset-missing"
  | "skip-lot";

export type Profile = { riskEnv: RiskEnv | null; validateOrders: boolean };

export type Explanation = {
  ruleId: RuleId;
  title: string;
  happened: string;
  /** The setting or check that fired. Env var names render in mono. */
  setting: string | null;
  change: string;
  /** "benign" for skips: the engine logs them as warnings, not failures. */
  kind: "refusal" | "benign";
  /** False when the rule is known but the broker's own message isn't. */
  detailKnown: boolean;
};

type Match = RegExpExecArray;
type Rule = {
  id: RuleId;
  patterns: RegExp[];
  build: (m: Match, e: RefuseEvent | SkipEvent, p: Profile | null) => Omit<Explanation, "ruleId" | "kind" | "detailKnown"> & {
    detailKnown?: boolean;
  };
};

const shares = (n: number) => `${Math.abs(n)} ${Math.abs(n) === 1 ? "share" : "shares"}`;
const usd = (s: string) => `$${Number(s).toLocaleString("en-US")}`;

// Lime's own validate_order messages that have a known meaning.
const BROKER_MESSAGES: { pattern: RegExp; happened: string; change: string }[] = [
  {
    pattern: /^insufficient buying power$/i,
    happened:
      "Lime's pre-trade check said the account doesn't have the buying power for this order. The engine's own risk limits passed; the broker said no.",
    change:
      "Size orders from the account's buying power, not a fixed amount, or fund the account. A live run would get the same rejection.",
  },
];

const RULES: Rule[] = [
  {
    id: "allowlist",
    patterns: [/^Lime order symbol '([^']+)' is not allowlisted$/],
    build: (m, _e, p) => {
      const list = p?.riskEnv?.ZIPLIME_ALLOWED_SYMBOLS;
      return {
        title: `${m[1]} isn't on the allowlist`,
        happened: `The strategy asked for ${m[1]}, and ZIPLIME_ALLOWED_SYMBOLS doesn't include it${list ? ` (it allows ${list.split(",").join(", ")})` : ""}. The engine stopped the order before asking Lime.`,
        setting: "ZIPLIME_ALLOWED_SYMBOLS",
        change: `Add ${m[1]} to the list if the strategy is meant to trade it, or set it to * to allow every symbol. If ${m[1]} is a surprise, the strategy's universe is wider than you think.`,
      };
    },
  },
  {
    id: "bad-quantity",
    patterns: [/^Lime order quantity must be positive and finite$/, /^Lime order quantity must be non-zero\.$/],
    build: () => ({
      title: "The order size wasn't a usable number",
      happened: "The quantity was zero, negative after sign handling, infinite or NaN. That comes from the strategy, not from a setting.",
      setting: null,
      change: "Find where the strategy computes the order size. A division by a zero price or an empty history window is the usual cause.",
    }),
  },
  {
    id: "max-quantity",
    patterns: [/^Lime order quantity exceeds the configured risk limit$/],
    build: (_m, e, p) => {
      const limit = p?.riskEnv?.ZIPLIME_MAX_ORDER_QUANTITY;
      return {
        title: "Too many shares in one order",
        happened: `The order asked for ${shares(e.requested_amount)}${limit ? `, and the limit is ${limit}` : ""}.`,
        setting: "ZIPLIME_MAX_ORDER_QUANTITY",
        change: "Raise the limit if the size is intended, or have the strategy split or size down the order.",
      };
    },
  },
  {
    id: "sell-disabled",
    patterns: [/^Lime sell orders are disabled by the configured risk limits$/],
    build: (_m, e) => ({
      title: "Sells are off under the fail-closed profile",
      happened: `The strategy tried to sell ${shares(e.requested_amount)} of ${e.symbol}. With ZIPLIME_REQUIRE_ORDER_RISK_LIMITS=true the engine refuses to start if ZIPLIME_ALLOW_SELL=true, because it can't yet prove a sell won't open a short.`,
      setting: "ZIPLIME_ALLOW_SELL",
      change: "Turning ZIPLIME_ALLOW_SELL on is not an option under this profile. Make the strategy buy-only, or run it without the fail-closed profile and accept that sells aren't bounded.",
    }),
  },
  {
    id: "bad-limit",
    patterns: [/^Lime limit price must be positive and finite$/],
    build: () => ({
      title: "The limit price wasn't a usable number",
      happened: "The limit price was zero, negative, infinite or NaN. That comes from the strategy.",
      setting: null,
      change: "Check how the strategy derives its limit price, for example from a missing bar.",
    }),
  },
  {
    id: "notional",
    patterns: [/^Lime order notional exceeds the configured risk limit$/],
    build: (_m, e, p) => {
      const cap = p?.riskEnv?.ZIPLIME_MAX_ORDER_NOTIONAL_USD;
      return {
        title: "Limit order worth more than the cap",
        happened: `${shares(e.requested_amount)} of ${e.symbol} times the limit price came to more than ${cap ? usd(cap) : "the notional cap"}. The file doesn't record the limit price of a refused order, so the exact amount isn't shown.`,
        setting: "ZIPLIME_MAX_ORDER_NOTIONAL_USD",
        change: "Raise the cap if orders this size are intended, or size orders by dollar amount so they stay under it.",
      };
    },
  },
  {
    id: "market-notional",
    patterns: [/^Lime market order notional exceeds the configured risk limit$/],
    build: (_m, e, p) => {
      const cap = p?.riskEnv?.ZIPLIME_MAX_ORDER_NOTIONAL_USD;
      return {
        title: "Market order worth more than the cap",
        happened: `A market order has no price of its own, so the engine priced ${shares(e.requested_amount)} of ${e.symbol} at the ${e.requested_amount > 0 ? "ask" : "bid"} from Lime's live quote. That came to more than ${cap ? usd(cap) : "the notional cap"}.`,
        setting: "ZIPLIME_MAX_ORDER_NOTIONAL_USD",
        change: "Size down, raise the cap, or use a limit order so the price you check is the price you send.",
      };
    },
  },
  {
    id: "order-style",
    patterns: [/^Lime (?:Trader SDK )?supports MarketOrder and LimitOrder only; got (\w+)/],
    build: (m) => ({
      title: `${m[1]} isn't supported on Lime`,
      happened: `The strategy used ${m[1]}. The Lime exchange in ziplime sends market and limit orders only.`,
      setting: null,
      change: "Use a market or limit order. A stop has to be handled in the strategy's own logic for now.",
    }),
  },
  {
    id: "max-orders",
    patterns: [/^Lime order count exceeds the per-invocation risk limit$/],
    build: (_m, _e, p) => {
      const cap = p?.riskEnv?.ZIPLIME_MAX_ORDERS_PER_INVOCATION;
      return {
        title: "Too many orders in one run",
        happened: `This run had already used its ${cap ?? "configured"} order attempts. An order refused by the symbol, quantity, sell or limit-notional check doesn't use an attempt; one refused later (market notional, broker validation, deadline) does.`,
        setting: "ZIPLIME_MAX_ORDERS_PER_INVOCATION",
        change: "If busy days legitimately need more orders, raise the limit. If not, the strategy is churning: look at why it fires so often.",
      };
    },
  },
  {
    id: "no-quote",
    patterns: [
      /^Lime returned no current quote for '([^']+)'; a market order cannot be bounded without one$/,
      /^Lime quote for '([^']+)' carries no usable price$/,
    ],
    build: (m) => ({
      title: `No usable quote for ${m[1]}`,
      happened: `The notional cap needs a price to check a market order against, and Lime returned none for ${m[1]}. The engine fails closed: no quote, no order.`,
      setting: "ZIPLIME_MAX_ORDER_NOTIONAL_USD (needs a quote)",
      change: "Use a limit order for this symbol, or let the strategy retry on the next bar. Don't remove the cap to get around it.",
    }),
  },
  {
    id: "deadline",
    patterns: [/^Lime order deadline expired before broker submission$/],
    build: () => ({
      title: "The signal went stale before it reached Lime",
      happened: "The order was still in the engine after ZIPLIME_ORDER_DEADLINE_UTC had passed, so it was dropped instead of sent late.",
      setting: "ZIPLIME_ORDER_DEADLINE_UTC",
      change: "Find out why the run was slow (data, queue, cold start). Moving the deadline later only hides that.",
    }),
  },
  {
    id: "deadline-config",
    patterns: [/^invalid ZIPLIME_ORDER_DEADLINE_UTC$/, /^ZIPLIME_ORDER_DEADLINE_UTC must include a timezone$/],
    build: () => ({
      title: "The order deadline is misconfigured",
      happened: "ZIPLIME_ORDER_DEADLINE_UTC isn't a valid ISO timestamp with a timezone, so the engine refuses every order rather than guess.",
      setting: "ZIPLIME_ORDER_DEADLINE_UTC",
      change: "Set it to an ISO timestamp with an offset, for example 2026-10-12T14:15:00+00:00.",
    }),
  },
  {
    id: "broker-validation",
    patterns: [/^Lime rejected order during validation: (.+)$/],
    build: (m) => {
      const known = BROKER_MESSAGES.find((b) => b.pattern.test(m[1]));
      if (known) {
        return {
          title: `Lime said no: ${m[1]}`,
          happened: known.happened,
          setting: "validate_order",
          change: known.change,
        };
      }
      return {
        title: "Lime rejected it in pre-trade validation",
        happened: `Lime's validate_order call refused the order with "${m[1]}". The engine's own checks passed. This broker message has no built-in explanation yet.`,
        setting: "validate_order",
        change: "Read Lime's message above. A live run would be rejected the same way.",
        detailKnown: false,
      };
    },
  },
  {
    id: "account",
    patterns: [
      /^Lime account '.*' is not available to these credentials\.$/,
      /^Several Lime accounts are available\./,
      /^Lime returned no brokerage accounts for these credentials\.$/,
    ],
    build: () => ({
      title: "The engine couldn't pick the Lime account",
      happened: "The credentials don't match the configured account, have several accounts and none was named, or have none at all. Automatic selection is off for safety.",
      setting: "LIME_SDK_ACCOUNT_ID",
      change: "Set LIME_SDK_ACCOUNT_ID (or the job spec's account_id) to the account this strategy should use.",
    }),
  },
  {
    id: "asset-missing",
    patterns: [/^Lime position\/order symbol '([^']+)' is absent from assets\.sqlite\./],
    build: (m) => ({
      title: `${m[1]} isn't in the asset database`,
      happened: `The engine looked ${m[1]} up in assets.sqlite on each US listing venue and didn't find it.`,
      setting: "assets.sqlite",
      change: `Add ${m[1]} with its listing MIC, then rerun.`,
    }),
  },
];

const SKIP_LOT = /^(-?\d+(?:\.\d+)?) (\S+) is below one lot \((\d+) shares?\); order not sent$/;

/** Splits "ValueError: message" into its parts. */
export function splitReason(reason: string): { type: string | null; message: string } {
  const m = /^([A-Za-z_][\w.]*): ([\s\S]*)$/.exec(reason);
  return m ? { type: m[1], message: m[2] } : { type: null, message: reason };
}

export function explain(event: RefuseEvent | SkipEvent, profile: Profile | null = null): Explanation | null {
  if (event.event === "skip") {
    const m = SKIP_LOT.exec(event.reason);
    if (!m) return null;
    return {
      ruleId: "skip-lot",
      kind: "benign",
      detailKnown: true,
      title: "Less than one share, so nothing to send",
      happened: `The strategy asked for ${m[1]} ${m[2]}. Lime trades whole shares, so that rounds to zero and the engine skips it. Not an error: a rebalance near its target routinely asks for a fraction.`,
      setting: "LOT_SIZE = 1",
      change: "Nothing, unless skips are most of the run. Then the strategy is rebalancing too often for the account size.",
    };
  }
  const { message } = splitReason(event.reason);
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const m = pattern.exec(message);
      if (!m) continue;
      const built = rule.build(m, event, profile);
      return { ruleId: rule.id, kind: "refusal", ...built, detailKnown: built.detailKnown ?? true };
    }
  }
  return null;
}

/** True when the console can't fully explain the reason on its own. */
export function needsClaude(explanation: Explanation | null): boolean {
  return explanation === null || !explanation.detailKnown;
}
