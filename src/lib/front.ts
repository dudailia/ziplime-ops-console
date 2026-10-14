// What the front door shows from the seed: the ticker's events and the line
// the hero terminal types out. Pure, so the tests can pin both.

import type { Dataset } from "./data/types";
import { fileOf } from "./data/lookup";
import { explain, type Explanation } from "./dryrun/explain";
import type { DryRunEvent, EventKind } from "./dryrun/types";

export type TickerItem = { key: string; account: string; symbol: string; event: EventKind };

/** Every event of the as-of day across all deployments, in clock order. */
export function tickerItems(ds: Dataset, limit = 32): TickerItem[] {
  const items: { item: TickerItem; minute: number }[] = [];
  for (const d of ds.deployments) {
    const session = fileOf(ds, d.id).sessions.find((s) => s.date === ds.calendar.asOf);
    for (const e of session?.events ?? []) {
      items.push({ item: { key: `${d.id}:${e.line}`, account: d.account, symbol: e.symbol ?? "?", event: e.event }, minute: e.clock.minuteET });
    }
  }
  items.sort((a, b) => a.minute - b.minute || a.item.key.localeCompare(b.item.key));
  return items.slice(0, limit).map((x) => x.item);
}

export type HeroLine = { deployment: string; event: DryRunEvent; explanation: Explanation };

/** The first refused line of the hero session, with the console's reading of it. */
export function heroLine(ds: Dataset, deploymentId: string, date: string): HeroLine {
  const d = ds.deployments.find((x) => x.id === deploymentId);
  const session = fileOf(ds, deploymentId).sessions.find((s) => s.date === date);
  for (const e of session?.events ?? []) {
    if (e.event !== "refuse") continue;
    const explanation = explain(e, d ? { riskEnv: d.riskEnv, validateOrders: d.validateOrders } : null);
    if (explanation) return { deployment: deploymentId, event: e, explanation };
  }
  throw new Error(`No explained refusal in ${deploymentId} on ${date}`);
}
