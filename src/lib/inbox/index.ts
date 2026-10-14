// Support tickets: seeded ones, plus ones the automations open. Replies are
// drafted (template or Claude), guarded, and count as sent only on Approve.

import ticketsJson from "../../../data/seed/tickets.json";
import { explain, type Profile } from "../dryrun/explain";
import { readiness } from "../dryrun/metrics";
import type { DryRunEvent, RefuseEvent, SkipEvent } from "../dryrun/types";
import { shortDate } from "../format";
import { deploymentById, fileOf } from "../data/lookup";
import type { Dataset } from "../data/types";
import type { Account, Deployment } from "../seed";

export type ReplySource = "template" | "claude" | "human";

export type Message = {
  from: "client" | "limex";
  author: string;
  at: string;
  body: string;
  /** Set on replies a person approved. */
  approvedBy?: string;
  source?: ReplySource;
};

export type TicketLink = { deployment: string; ids: string[] };

export type Ticket = {
  id: string;
  accountId: string;
  subject: string;
  createdAt: string;
  messages: Message[];
  links: TicketLink[];
  /** A draft someone left on the ticket before this session. */
  draft?: { by: string; text: string };
  /** Set when an automation rule opened the ticket. */
  rule?: { id: string; trigger: string };
};

export const SEED_TICKETS = ticketsJson.tickets as Ticket[];

export type Linked = { deployment: Deployment; profile: Profile; events: DryRunEvent[] };

function idsOf(e: DryRunEvent): string[] {
  switch (e.event) {
    case "place":
      return [e.ziplime_order_id, e.dry_run_id, e.client_order_id];
    case "cancel":
      return [e.dry_run_id];
    default:
      return [e.ziplime_order_id];
  }
}

/** The ticket's linked lines, looked up in that account's own dry-run files only. */
export function linkedEvents(ds: Dataset, ticket: Pick<Ticket, "accountId" | "links">): Linked[] {
  const out: Linked[] = [];
  for (const link of ticket.links) {
    const deployment = deploymentById(ds, link.deployment);
    if (!deployment || deployment.account !== ticket.accountId) continue;
    const wanted = new Set(link.ids);
    const events = fileOf(ds, deployment.id).events.filter((e) => idsOf(e).some((id) => wanted.has(id)));
    out.push({ deployment, profile: { riskEnv: deployment.riskEnv, validateOrders: deployment.validateOrders }, events });
  }
  return out;
}

const firstName = (a: Account) => a.trader.split(" ")[0];
const joinList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** A deterministic reply built from the same data Claude would get. */
export function templateReply(ds: Dataset, ticket: Ticket, account: Account): string {
  const parts: string[] = [`Hi ${firstName(account)},`, "", "Thanks for writing in. Here is what your dry-run file shows."];
  for (const { deployment, profile, events } of linkedEvents(ds, ticket)) {
    const why = events.filter((e): e is RefuseEvent | SkipEvent => e.event === "refuse" || e.event === "skip");
    const groups = new Map<string, (RefuseEvent | SkipEvent)[]>();
    for (const e of why) {
      // By title, so "AMD isn't on the allowlist" and "TSLA isn't..." stay separate.
      const key = explain(e, profile)?.title ?? `?${e.reason}`;
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    for (const list of groups.values()) {
      const x = explain(list[0], profile);
      const symbols = joinList([...new Set(list.map((e) => e.symbol))]);
      const dates = joinList([...new Set(list.map((e) => shortDate(e.clock.session)))]);
      const verb = list[0].event === "skip" ? (list.length === 1 ? "order was skipped" : "orders were skipped") : list.length === 1 ? "order was refused" : "orders were refused";
      parts.push("", `In ${deployment.strategy}, ${list.length} ${verb} for ${symbols} (${dates}).`);
      if (x) {
        parts.push(`${x.happened}`, "", `What to change: ${x.change}`);
      } else {
        parts.push(`The engine wrote: "${list[0].reason}". We don't have a built-in explanation for that message yet, and we'll follow up once we've checked it.`);
      }
    }
    if (why.length === 0) {
      const failed = readiness(fileOf(ds, deployment.id), profile).filter((c) => !c.pass);
      if (failed.length === 0) {
        parts.push("", `${deployment.strategy} passes all six readiness checks in the console. A person at Limex reviews every switch to live, and we'll pick that up with you.`);
      } else {
        parts.push("", `${deployment.strategy} doesn't pass ${failed.length === 1 ? "one readiness check" : `${failed.length} readiness checks`} yet:`);
        for (const c of failed) parts.push(`- ${c.label}. ${c.evidence}`);
        parts.push("", "A person at Limex reviews every switch to live, so we'll go through these with you first.");
      }
    }
  }
  parts.push("", "You can open each of these lines in the Dry-run review in the portal.", "", "The Limex team");
  return parts.join("\n");
}

export type ReplyStatus = "empty" | "flagged" | "in_review";

export function replyStatus(text: string, hitCount: number): ReplyStatus {
  if (text.trim() === "") return "empty";
  return hitCount > 0 ? "flagged" : "in_review";
}
