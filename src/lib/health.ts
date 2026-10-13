// Account health for the ops CRM (PLAN.md section 4, corrected in section 14).
// Computed over each deployment's last 5 sessions against a fixed asOf date,
// so the colours don't drift with the real clock.

import { explain, needsClaude, type Profile } from "./dryrun/explain";
import { countEvents, refusalRate } from "./dryrun/parse";
import type { ParsedFile } from "./dryrun/types";

export type HealthLevel = "red" | "amber" | "green" | "grey";
export type HealthReason = { level: HealthLevel; text: string; deployment?: string };
export type Health = { level: HealthLevel; reasons: HealthReason[] };

export const HEALTH_WINDOW = 5;
export const STALE_AFTER_TRADING_DAYS = 3;

export const HEALTH_LABEL: Record<HealthLevel, string> = {
  red: "Needs help",
  amber: "Watch",
  green: "Healthy",
  grey: "No sessions yet",
};

const RANK: Record<HealthLevel, number> = { red: 3, amber: 2, green: 1, grey: 0 };

export type Calendar = { asOf: string; tradingDays: readonly string[] };

/** Trading days from `from` to `to`, using the calendar when both are in it, else weekdays. */
export function tradingDaysBetween(from: string, to: string, days: readonly string[]): number {
  const a = days.indexOf(from);
  const b = days.indexOf(to);
  if (a >= 0 && b >= 0) return b - a;
  let n = 0;
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n += 1;
  }
  return n;
}

const pct = (r: number) => `${Math.round(r * 100)}%`;

export function deploymentHealth(file: ParsedFile, profile: Profile | null, cal: Calendar, label?: string): Health {
  const recent = file.sessions.filter((s) => s.date <= cal.asOf).slice(-HEALTH_WINDOW);
  if (recent.length === 0) return { level: "grey", reasons: [{ level: "grey", text: "No dry-run sessions yet", deployment: label }] };

  const events = recent.flatMap((s) => s.events);
  const counts = countEvents(events);
  const rate = refusalRate(counts);
  const refusals = events.filter((e) => e.event === "refuse");
  const broker = refusals.filter((e) => explain(e, profile)?.ruleId === "broker-validation");
  const unexplained = events.filter((e) => (e.event === "refuse" || e.event === "skip") && needsClaude(explain(e, profile)));
  const unvalidated = events.filter((e) => e.event === "place" && !e.broker_validated);
  const last = recent[recent.length - 1].date;
  const gap = tradingDaysBetween(last, cal.asOf, cal.tradingDays);

  const reasons: HealthReason[] = [];
  const add = (level: HealthLevel, text: string) => reasons.push({ level, text, deployment: label });
  const window = `last ${recent.length} session${recent.length === 1 ? "" : "s"}`;

  if (rate >= 0.2) add("red", `${pct(rate)} of orders refused over the ${window}`);
  else if (rate >= 0.05) add("amber", `${pct(rate)} of orders refused over the ${window}`);
  if (broker.length >= 2) add("red", `Lime rejected ${broker.length} orders in pre-trade validation`);
  else if (broker.length === 1) add("amber", "Lime rejected 1 order in pre-trade validation");
  if (gap > STALE_AFTER_TRADING_DAYS) add("amber", `No dry run for ${gap} trading days`);
  if (unvalidated.length > 0) add("amber", "Runs with validate_orders=False: Lime never checked the orders");
  if (unexplained.length > 0) add("amber", `${unexplained.length} refusal${unexplained.length === 1 ? "" : "s"} with no built-in explanation`);

  if (reasons.length === 0) {
    return { level: "green", reasons: [{ level: "green", text: `No refusals that need action over the ${window}`, deployment: label }] };
  }
  reasons.sort((a, b) => RANK[b.level] - RANK[a.level]);
  return { level: reasons[0].level, reasons };
}

/** The worst deployment decides. Every reason is kept, worst first. */
export function combineHealth(parts: Health[]): Health {
  if (parts.length === 0) return { level: "grey", reasons: [{ level: "grey", text: "No deployments yet" }] };
  const level = parts.reduce<HealthLevel>((worst, h) => (RANK[h.level] > RANK[worst] ? h.level : worst), "grey");
  const reasons = parts.flatMap((h) => h.reasons).filter((r) => r.level === level || RANK[r.level] >= RANK.amber);
  reasons.sort((a, b) => RANK[b.level] - RANK[a.level]);
  return { level, reasons };
}

export function healthRank(level: HealthLevel): number {
  return RANK[level];
}
