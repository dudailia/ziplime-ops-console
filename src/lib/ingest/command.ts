// What the console tells a newly onboarded trader to run (PLAN.md 15.7).

import type { RiskEnv } from "../seed";

/**
 * The starting risk profile for a deployment created on approval. Every value
 * passes the engine's own checks in _load_order_risk_limits: limits required,
 * sells off (the fail-closed profile refuses ZIPLIME_ALLOW_SELL=true), and "*"
 * for symbols, which the engine reads as no symbol restriction.
 */
export const STARTER_PROFILE: RiskEnv = {
  ZIPLIME_REQUIRE_ORDER_RISK_LIMITS: "true",
  ZIPLIME_ALLOW_SELL: "false",
  ZIPLIME_MAX_ORDER_QUANTITY: "100",
  ZIPLIME_MAX_ORDER_NOTIONAL_USD: "25000",
  ZIPLIME_MAX_ORDERS_PER_INVOCATION: "10",
  ZIPLIME_ALLOWED_SYMBOLS: "*",
};

export type ForwarderSetup = { secretFile: string; save: string; run: string };

/**
 * The exact commands: save the secret to a file only the trader can read
 * (paste it, then Ctrl-D, so it never lands in shell history), then run the
 * forwarder against this console.
 */
export function forwarderSetup(origin: string, deploymentId: string): ForwarderSetup {
  const secretFile = `~/.ziplime/${deploymentId}.secret`;
  return {
    secretFile,
    save: `mkdir -p ~/.ziplime && (umask 077 && cat > ${secretFile})`,
    run: [
      "python forwarder/ziplime_forwarder.py",
      `  --file run/${deploymentId}.jsonl`,
      `  --url ${origin}/api/ingest/${deploymentId}`,
      `  --secret-file ${secretFile}`,
      `  --state run/${deploymentId}.forwarder.json`,
    ].join(" \\\n"),
  };
}
