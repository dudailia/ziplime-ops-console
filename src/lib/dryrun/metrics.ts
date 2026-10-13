// Numbers derived from a parsed dry-run file. Pure functions.

import { explain, needsClaude, type Explanation, type Profile, type RuleId } from "./explain";
import type { DryRunEvent, EventKind, ParsedFile, PlaceEvent, RefuseEvent, Session, SkipEvent } from "./types";

/** Ids of places that a later cancel line names. */
export function cancelledIds(events: readonly DryRunEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const e of events) if (e.event === "cancel" && e.known_order) ids.add(e.dry_run_id);
  return ids;
}

/** The side of an event. A refusal or skip has none in the file; its sign says it. */
export function sideOf(e: DryRunEvent): "buy" | "sell" | null {
  if (e.event === "place") return e.side;
  if (e.event === "cancel") return null;
  return e.requested_amount < 0 ? "sell" : "buy";
}

export type NetRow = {
  symbol: string;
  bought: number;
  sold: number;
  cancelled: number;
  /** Signed shares of uncancelled places: what would have been sent. */
  net: number;
};

export function netShares(events: readonly DryRunEvent[]): NetRow[] {
  const cancelled = cancelledIds(events);
  const rows = new Map<string, NetRow>();
  for (const e of events) {
    if (e.event !== "place") continue;
    const row = rows.get(e.symbol) ?? { symbol: e.symbol, bought: 0, sold: 0, cancelled: 0, net: 0 };
    const qty = Number(e.quantity);
    if (cancelled.has(e.dry_run_id)) {
      row.cancelled += qty;
    } else if (e.side === "buy") {
      row.bought += qty;
      row.net += qty;
    } else {
      row.sold += qty;
      row.net -= qty;
    }
    rows.set(e.symbol, row);
  }
  return [...rows.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** The event a session cell is coloured by: the worst one in it. */
export function worstEvent(session: Session): EventKind | null {
  for (const kind of ["refuse", "skip", "cancel", "place"] as const) {
    if (session.counts[kind] > 0) return kind;
  }
  return null;
}

export type WhyGroup = {
  key: string;
  ruleId: RuleId | null;
  title: string;
  kind: "refusal" | "benign" | "unknown";
  events: (RefuseEvent | SkipEvent)[];
  explanation: Explanation | null;
};

/** Refusals and skips grouped by the rule that explains them, worst first. */
export function whyGroups(events: readonly DryRunEvent[], profile: Profile | null): WhyGroup[] {
  const groups = new Map<string, WhyGroup>();
  for (const e of events) {
    if (e.event !== "refuse" && e.event !== "skip") continue;
    const x = explain(e, profile);
    const key = x === null ? `unknown:${e.reason}` : needsClaude(x) ? `${x.ruleId}:${e.reason}` : x.ruleId;
    const group = groups.get(key) ?? {
      key,
      ruleId: x?.ruleId ?? null,
      title: x?.title ?? "No built-in explanation",
      kind: x === null ? "unknown" : x.kind,
      events: [],
      explanation: x,
    };
    group.events.push(e);
    groups.set(key, group);
  }
  const rank = { unknown: 0, refusal: 1, benign: 2 } as const;
  return [...groups.values()].sort(
    (a, b) => rank[a.kind] - rank[b.kind] || b.events.length - a.events.length,
  );
}

export type CheckResult = {
  id: string;
  label: string;
  pass: boolean;
  evidence: string;
};

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Ready to go live?" The six checks in PLAN.md section 4, over the last n sessions. */
export function readiness(file: ParsedFile, profile: Profile | null, n = 3): CheckResult[] {
  const recent = file.sessions.slice(-n);
  const all = file.events;
  const checks: CheckResult[] = [];

  checks.push({
    id: "sessions",
    label: `At least ${plural(n, "session")} recorded`,
    pass: file.sessions.length >= n,
    evidence: `${plural(file.sessions.length, "session")} in the file.`,
  });

  const recentRefusals = recent.flatMap((s) => s.events.filter((e) => e.event === "refuse"));
  checks.push({
    id: "no-refusals",
    label: `No refusals in the last ${plural(n, "session")}`,
    pass: recent.length > 0 && recentRefusals.length === 0,
    evidence:
      recent.length === 0
        ? "No sessions yet."
        : recentRefusals.length === 0
          ? `None from ${recent[0].date} to ${recent[recent.length - 1].date}.`
          : `${plural(recentRefusals.length, "refusal")}, first on line ${recentRefusals[0].line} (${recentRefusals[0].clock.session}).`,
  });

  const allowlistHits = all.filter(
    (e): e is RefuseEvent => e.event === "refuse" && explain(e, profile)?.ruleId === "allowlist",
  );
  const allowed = profile?.riskEnv?.ZIPLIME_ALLOWED_SYMBOLS;
  const allowedSet = allowed && allowed !== "*" ? new Set(allowed.split(",").map((s) => s.trim().toUpperCase())) : null;
  const outside = allowedSet
    ? all.filter((e): e is PlaceEvent => e.event === "place" && !allowedSet.has(e.symbol.toUpperCase()))
    : [];
  checks.push({
    id: "allowlist",
    label: "Every symbol is on the allowlist",
    pass: allowlistHits.length === 0 && outside.length === 0,
    evidence:
      allowlistHits.length > 0
        ? `${plural(allowlistHits.length, "refusal")} for ${[...new Set(allowlistHits.map((e) => e.symbol))].join(", ")}, first on line ${allowlistHits[0].line}.`
        : outside.length > 0
          ? `${outside[0].symbol} placed on line ${outside[0].line} but isn't in ZIPLIME_ALLOWED_SYMBOLS.`
          : allowedSet
            ? `All placed symbols are in ZIPLIME_ALLOWED_SYMBOLS.`
            : profile?.riskEnv
              ? "No allowlist set, and no allowlist refusals."
              : "No risk profile known, and no allowlist refusals.",
  });

  const counts = recent.map((s) => s.counts.place);
  const med = counts.length ? median(counts) : 0;
  const off = recent.filter((s) => med === 0 || Math.abs(s.counts.place - med) > 0.3 * med);
  checks.push({
    id: "stable",
    label: "Stable order counts (within 30% of the median)",
    pass: recent.length >= n && off.length === 0,
    evidence:
      recent.length === 0
        ? "No sessions yet."
        : off.length === 0
          ? `${counts.join(", ")} orders a session; median ${med}.`
          : `${off.map((s) => `${s.date}: ${s.counts.place}`).join("; ")} against a median of ${med}.`,
  });

  const places = all.filter((e): e is PlaceEvent => e.event === "place");
  const unvalidated = places.filter((e) => !e.broker_validated);
  checks.push({
    id: "validated",
    label: "Every order went through Lime's validate_order",
    pass: places.length > 0 && unvalidated.length === 0,
    evidence:
      places.length === 0
        ? "No placed orders to check."
        : unvalidated.length === 0
          ? `All ${places.length} placed orders were validated by Lime.`
          : `${unvalidated.length} of ${places.length} placed orders have broker_validated: false (first on line ${unvalidated[0].line}). The run never asked Lime, so it proves less.`,
  });

  checks.push({
    id: "clean-file",
    label: "The file parsed with no malformed lines",
    pass: file.errors.length === 0,
    evidence:
      file.errors.length === 0
        ? `${plural(all.length, "line")}, all valid.`
        : `${plural(file.errors.length, "malformed line")}: ${file.errors.slice(0, 5).map((e) => e.line).join(", ")}${file.errors.length > 5 ? "…" : ""}.`,
  });

  return checks;
}
