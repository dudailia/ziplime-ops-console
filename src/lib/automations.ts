// Automation rules (PLAN.md section 9). Pure: (dataset, state) -> effects,
// so a run is testable and the log shows exactly what it did. Idempotent: an
// effect whose id already exists is skipped and logged as such. Rules open
// tickets and write notes; they never send anything.

import { summarizeDeployment } from "./crm";
import type { Dataset } from "./data/types";
import { explain } from "./dryrun/explain";
import type { RefuseEvent } from "./dryrun/types";
import { shortDate } from "./format";
import { STALE_AFTER_TRADING_DAYS, tradingDaysBetween } from "./health";
import { templateReply, type Ticket } from "./inbox";
import type { Deployment } from "./seed";
import { allAccounts, allTickets, type Activity, type State } from "./store/state";

export type RuleId = "refusal-streak" | "broker-rejection" | "stale" | "ready-for-live";

export const RULES: { id: RuleId; name: string; when: string; then: string }[] = [
  {
    id: "refusal-streak",
    name: "Refusals three sessions running",
    when: "A deployment has refusals in each of its last 3 sessions.",
    then: "Open a ticket on the account, linked to the latest refusals, with a template draft waiting for review. Never sends.",
  },
  {
    id: "broker-rejection",
    name: "Lime rejected an order",
    when: "Lime's validate_order rejected an order in the latest session.",
    then: "Add a note to the account's activity log.",
  },
  {
    id: "stale",
    name: "Dry run went quiet",
    when: `A deployment has had no session for more than ${STALE_AFTER_TRADING_DAYS} trading days.`,
    then: "Add a \"dry run stale\" note to the account's activity log.",
  },
  {
    id: "ready-for-live",
    name: "Ready for a live review",
    when: "A deployment passes all six readiness checks.",
    then: "Add a note for a person to review. Nothing switches to live on its own.",
  },
];

export type LogLine = { rule: RuleId; accountId: string; deployment: string; text: string; skipped: boolean };
export type Run = { id: string; at: string; by: string; lines: LogLine[] };

export type RunResult = { tickets: Ticket[]; activity: Activity[]; lines: LogLine[] };

export function runRules(ds: Dataset, state: State, enabled: Record<RuleId, boolean>, at: string): RunResult {
  const ticketIds = new Set(allTickets(ds, state).map((t) => t.id));
  const activityIds = new Set(state.activity.map((a) => a.id));
  const out: RunResult = { tickets: [], activity: [], lines: [] };
  const accounts = allAccounts(ds, state);
  const accountOf = (id: string) => accounts.find((a) => a.id === id)!;
  const asOf = ds.calendar.asOf;

  const note = (rule: RuleId, d: Deployment, id: string, text: string) => {
    if (activityIds.has(id)) {
      out.lines.push({ rule, accountId: d.account, deployment: d.id, text: `Skipped: note already added. ${text}`, skipped: true });
      return;
    }
    activityIds.add(id);
    out.activity.push({ id, accountId: d.account, at, kind: "automation", text, by: `Rule: ${RULES.find((r) => r.id === rule)!.name}` });
    out.lines.push({ rule, accountId: d.account, deployment: d.id, text: `Note added. ${text}`, skipped: false });
  };

  for (const d of ds.deployments) {
    const s = summarizeDeployment(ds, d);
    const sessions = s.file.sessions.filter((x) => x.date <= asOf);
    const last = sessions.at(-1);

    if (enabled["refusal-streak"]) {
      const recent = sessions.slice(-3);
      if (recent.length === 3 && recent.every((x) => x.counts.refuse > 0)) {
        // One ticket per streak: keyed to the first session of the unbroken run
        // of refusal sessions, so a later streak after a clean session opens a
        // new one even if this one was answered.
        let first = sessions.length - 1;
        while (first > 0 && sessions[first - 1].counts.refuse > 0) first--;
        const since = sessions[first].date;
        const id = `A-${d.id}-streak-${since}`;
        const trigger = `refusals on ${recent.map((x) => shortDate(x.date)).join(", ")}`;
        if (ticketIds.has(id)) {
          out.lines.push({
            rule: "refusal-streak",
            accountId: d.account,
            deployment: d.id,
            text: `Skipped: the streak since ${shortDate(since)} already has ticket ${id}.`,
            skipped: true,
          });
        } else {
          const latest = recent.at(-1)!.events.filter((e): e is RefuseEvent => e.event === "refuse");
          const ticket: Ticket = {
            id,
            accountId: d.account,
            subject: `Refusals three sessions running: ${d.strategy}`,
            createdAt: at,
            messages: [],
            links: [{ deployment: d.id, ids: latest.map((e) => e.ziplime_order_id) }],
            rule: { id: "refusal-streak", trigger },
          };
          ticket.draft = { by: "Automation (template)", text: templateReply(ds, ticket, accountOf(d.account)) };
          ticketIds.add(id);
          out.tickets.push(ticket);
          out.activity.push({
            id: `act-${id}`,
            accountId: d.account,
            at,
            kind: "automation",
            text: `Rule opened ticket ${id} (${trigger}). Draft waiting for review.`,
            by: "Rule: Refusals three sessions running",
          });
          out.lines.push({ rule: "refusal-streak", accountId: d.account, deployment: d.id, text: `Opened ticket ${id}, ${trigger}. Draft in review, not sent.`, skipped: false });
        }
      }
    }

    if (enabled["broker-rejection"] && last && last.date === asOf) {
      const rejected = last.events.filter((e) => e.event === "refuse" && explain(e, s.profile)?.ruleId === "broker-validation");
      if (rejected.length > 0) {
        note(
          "broker-rejection",
          d,
          `A-${d.id}-broker-${last.date}`,
          `Lime rejected ${rejected.length} order${rejected.length === 1 ? "" : "s"} in validation on ${shortDate(last.date)} in ${d.strategy}.`,
        );
      }
    }

    if (enabled.stale && last) {
      const gap = tradingDaysBetween(last.date, asOf, ds.calendar.tradingDays);
      if (gap > STALE_AFTER_TRADING_DAYS) {
        note("stale", d, `A-${d.id}-stale-${last.date}`, `Dry run stale: ${d.strategy} last ran ${shortDate(last.date)}, ${gap} trading days ago.`);
      }
    }

    if (enabled["ready-for-live"] && s.checksPassed === s.checksTotal) {
      note("ready-for-live", d, `A-${d.id}-ready`, `Ready for live review: ${d.strategy} passes all six readiness checks. A person decides.`);
    }
  }
  return out;
}

