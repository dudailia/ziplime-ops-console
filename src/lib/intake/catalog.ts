// Brokers limex.com lists as connected via SnapTrade (checked 2026-10-13),
// and placeholder Workspace names (PLAN.md decision 5).

export const BROKERS = ["Robinhood", "Charles Schwab", "Fidelity", "E*TRADE", "Interactive Brokers", "Coinbase"] as const;
export type Broker = (typeof BROKERS)[number];
export const BROKERS_MORE = "+ 19 more via SnapTrade US";

/** Placeholder names; limex.com doesn't list its Workspaces yet. */
export const WORKSPACES = [
  { key: "getting-started", name: "Getting started" },
  { key: "options", name: "Options" },
  { key: "crypto", name: "Crypto" },
  { key: "swing", name: "Swing setups" },
  { key: "day", name: "Day trading" },
  { key: "prop", name: "Prop / funded" },
] as const;
export type WorkspaceKey = (typeof WORKSPACES)[number]["key"];
export const WORKSPACE_NOTE = "Placeholder names; limex.com doesn't list its Workspaces yet.";

export function workspaceName(key: WorkspaceKey): string {
  return WORKSPACES.find((w) => w.key === key)?.name ?? key;
}

export const TRADER_TYPES = [
  "Beginner",
  "Part-time",
  "Day trader",
  "Swing trader",
  "Options trader",
  "Futures trader",
  "Crypto trader",
  "Prop / funded",
  "Quant / systematic",
  "Not enough to tell",
] as const;
export type TraderType = (typeof TRADER_TYPES)[number];
