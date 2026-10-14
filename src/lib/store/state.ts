// The demo's mutable state: everything a person can change. The dataset
// (seed or database) is never copied in here; functions that need it take it
// as an argument. Pure reducer, so it is testable.

import { otherClients } from "../crm";
import { guard } from "../guard";
import type { RuleId, Run } from "../automations";
import type { Dataset } from "../data/types";
import type { Message, ReplySource, Ticket } from "../inbox";
import { accountFromSignup, signupById } from "../intake";
import type { Triage } from "../intake/triage";
import type { Account } from "../seed";

export const STORAGE_KEY = "ziplime-ops-console:v1";
/** Database mode keeps its browser state apart, so static-demo approvals never show up there. */
export const DB_STORAGE_KEY = "ziplime-ops-console:v1:database";

export type ActivityKind = "automation" | "intake" | "ticket" | "note";

export type Activity = {
  id: string;
  accountId: string;
  /** ISO timestamp. */
  at: string;
  kind: ActivityKind;
  text: string;
  by: string;
};

export type IntakeRecord = {
  decision?: { kind: "approved" | "dismissed"; by: string; at: string; accountId?: string };
  /** Claude's triage, when someone asked for it. */
  claude?: Triage;
  /** Which version the reviewer is working from. */
  use: "rules" | "claude";
  /** The reviewer's edits to the welcome email, if any. */
  draft?: { subject: string; body: string };
};

export const REVIEWER = "Demo reviewer";

export type Reply = { text: string; source: ReplySource; by: string; updatedAt: string };

export type State = {
  v: 1;
  /** Claude's answers for reasons with no built-in rule, keyed by reason string. */
  explainCache: Record<string, string>;
  /** Accounts created by approving a Beta signup. */
  extraAccounts: Account[];
  activity: Activity[];
  intake: Record<string, IntakeRecord>;
  /** Tickets opened by automation rules. */
  createdTickets: Ticket[];
  /** The reply being drafted per ticket. A seeded draft shows until this is set. */
  replies: Record<string, Reply | null>;
  /** Approved replies, appended to each ticket's thread. */
  sent: Record<string, Message[]>;
  rules: Record<RuleId, boolean>;
  /** Automation runs, newest first. */
  runs: Run[];
};

export type Action =
  | { type: "hydrate"; state: State }
  | { type: "reset" }
  | { type: "explain/cache"; reason: string; text: string }
  | { type: "intake/claude"; id: string; triage: Triage }
  | { type: "intake/use"; id: string; use: "rules" | "claude" }
  | { type: "intake/edit"; id: string; subject: string; body: string }
  | { type: "intake/approve"; id: string; by: string; at: string; email: { subject: string; body: string } }
  | { type: "intake/dismiss"; id: string; by: string; at: string }
  | { type: "intake/reopen"; id: string }
  | { type: "reply/set"; ticketId: string; text: string; source: ReplySource; by: string; at: string }
  | { type: "reply/discard"; ticketId: string }
  | { type: "reply/approve"; ticketId: string; by: string; at: string }
  | { type: "tickets/create"; tickets: Ticket[]; activity: Activity[] }
  | { type: "activity/add"; entries: Activity[] }
  | { type: "rules/toggle"; rule: RuleId }
  | { type: "rules/run"; run: Run; tickets: Ticket[]; activity: Activity[] };

export function initialState(): State {
  return { v: 1, explainCache: {}, extraAccounts: [], activity: [], intake: {}, createdTickets: [], replies: {}, sent: {},
    rules: { "refusal-streak": true, "broker-rejection": true, stale: true, "ready-for-live": true },
    runs: [],
  };
}

export function reducer(state: State, action: Action, ds: Dataset): State {
  switch (action.type) {
    case "hydrate":
      return action.state;
    case "reset":
      return initialState();
    case "explain/cache":
      return { ...state, explainCache: { ...state.explainCache, [action.reason]: action.text } };
    case "intake/claude":
      return patchIntake(state, action.id, { claude: action.triage, use: "claude", draft: undefined });
    case "intake/use":
      return patchIntake(state, action.id, { use: action.use, draft: undefined });
    case "intake/edit":
      return patchIntake(state, action.id, { draft: { subject: action.subject, body: action.body } });
    case "intake/approve":
      return approveSignup(ds, state, action);
    case "intake/dismiss": {
      const rec = state.intake[action.id];
      if (rec?.decision) return state;
      return patchIntake(state, action.id, { decision: { kind: "dismissed", by: action.by, at: action.at } });
    }
    case "reply/set":
      return {
        ...state,
        replies: { ...state.replies, [action.ticketId]: { text: action.text, source: action.source, by: action.by, updatedAt: action.at } },
      };
    case "reply/discard":
      return { ...state, replies: { ...state.replies, [action.ticketId]: null } };
    case "reply/approve":
      return approveReply(ds, state, action);
    case "tickets/create": {
      const known = new Set(allTickets(ds, state).map((t) => t.id));
      const fresh = action.tickets.filter((t) => !known.has(t.id));
      return { ...state, createdTickets: [...state.createdTickets, ...fresh], activity: [...state.activity, ...action.activity] };
    }
    case "rules/toggle":
      return { ...state, rules: { ...state.rules, [action.rule]: !state.rules[action.rule] } };
    case "rules/run": {
      const known = new Set(allTickets(ds, state).map((t) => t.id));
      const seen = new Set(state.activity.map((a) => a.id));
      return {
        ...state,
        createdTickets: [...state.createdTickets, ...action.tickets.filter((t) => !known.has(t.id))],
        activity: [...state.activity, ...action.activity.filter((a) => !seen.has(a.id))],
        runs: [action.run, ...state.runs].slice(0, 20),
      };
    }
    case "activity/add":
      return { ...state, activity: [...state.activity, ...action.entries] };
    case "intake/reopen": {
      const rec = state.intake[action.id];
      if (rec?.decision?.kind !== "dismissed") return state;
      return patchIntake(state, action.id, { decision: undefined });
    }
  }
}

function patchIntake(state: State, id: string, patch: Partial<IntakeRecord>): State {
  const prev = state.intake[id] ?? { use: "rules" };
  if (prev.decision && !("decision" in patch)) return state;
  return { ...state, intake: { ...state.intake, [id]: { ...prev, ...patch } } };
}

export function allAccounts(ds: Dataset, state: State): Account[] {
  return mergeAccounts(ds.accounts, state.extraAccounts);
}

/** The dataset's accounts, then the ones approved in this browser that the dataset doesn't have. */
export function mergeAccounts(base: readonly Account[], extra: readonly Account[]): Account[] {
  const known = new Set(base.map((a) => a.id));
  return [...base, ...extra.filter((a) => !known.has(a.id))];
}

/** Identifiers the welcome email to this signup must not mention. */
export function intakeOthers(ds: Dataset, state: State, signupId: string): string[] {
  const others = ds.signups.filter((s) => s.id !== signupId).map((s) => s.email);
  return [...otherClients("", allAccounts(ds, state)), ...others];
}

// Approving creates exactly one Beta account, and only if the email passes the guard.
// In database mode the server does this instead (lib/data/onboarding.ts).
function approveSignup(ds: Dataset, state: State, action: Extract<Action, { type: "intake/approve" }>): State {
  const signup = signupById(ds.signups, action.id);
  if (!signup || state.intake[action.id]?.decision || ds.decisions[action.id]) return state;
  if (state.extraAccounts.some((a) => a.fromIntake === action.id)) return state;
  const text = `${action.email.subject}\n${action.email.body}`;
  if (!guard(text, { intake: true, otherClients: intakeOthers(ds, state, action.id) }).ok) return state;
  const account = accountFromSignup(signup, allAccounts(ds, state).map((a) => a.id), action.at);
  const next = patchIntake(state, action.id, {
    decision: { kind: "approved", by: action.by, at: action.at, accountId: account.id },
    draft: action.email,
  });
  return {
    ...next,
    extraAccounts: [...next.extraAccounts, account],
    activity: [
      ...next.activity,
      { id: `act-${action.id}`, accountId: account.id, at: action.at, kind: "intake", text: `Approved from Beta intake by ${action.by}. Welcome email marked as sent.`, by: action.by },
    ],
  };
}

/** Reads saved state. Anything unexpected falls back to the seed. */
export function revive(raw: string | null): State | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<State>;
    if (value?.v !== 1) return null;
    return { ...initialState(), ...value } as State;
  } catch {
    return null;
  }
}

export function allTickets(ds: Dataset, state: State): Ticket[] {
  return [...ds.tickets, ...state.createdTickets];
}

/** The draft on a ticket: this session's reply, else a seeded draft, else nothing. */
export function currentReply(state: State, ticket: Ticket): Reply | null {
  if (ticket.id in state.replies) return state.replies[ticket.id];
  if (ticket.draft) return { text: ticket.draft.text, source: "human", by: ticket.draft.by, updatedAt: ticket.createdAt };
  return null;
}

export function replyHits(ds: Dataset, state: State, ticket: Ticket, text: string) {
  return guard(text, { otherClients: otherClients(ticket.accountId, allAccounts(ds, state)) }).hits;
}

export function thread(state: State, ticket: Ticket): Message[] {
  return [...ticket.messages, ...(state.sent[ticket.id] ?? [])];
}

/** Waiting on Limex: the last message is the client's. */
export function needsReply(state: State, ticket: Ticket): boolean {
  const t = thread(state, ticket);
  return t.length > 0 && t[t.length - 1].from === "client";
}

// Only a human click lands here, and only for a draft the guard passes.
function approveReply(ds: Dataset, state: State, action: Extract<Action, { type: "reply/approve" }>): State {
  const ticket = allTickets(ds, state).find((t) => t.id === action.ticketId);
  if (!ticket) return state;
  const reply = currentReply(state, ticket);
  if (!reply || replyStatusOf(ds, state, ticket, reply.text) !== "in_review") return state;
  const message: Message = { from: "limex", author: "The Limex team", at: action.at, body: reply.text, approvedBy: action.by, source: reply.source };
  return {
    ...state,
    sent: { ...state.sent, [ticket.id]: [...(state.sent[ticket.id] ?? []), message] },
    replies: { ...state.replies, [ticket.id]: null },
    activity: [
      ...state.activity,
      {
        id: `act-${ticket.id}-${state.sent[ticket.id]?.length ?? 0}`,
        accountId: ticket.accountId,
        at: action.at,
        kind: "ticket",
        text: `Reply on ${ticket.id} approved by ${action.by} and marked as sent.`,
        by: action.by,
      },
    ],
  };
}

function replyStatusOf(ds: Dataset, state: State, ticket: Ticket, text: string) {
  if (text.trim() === "") return "empty";
  return replyHits(ds, state, ticket, text).length > 0 ? "flagged" : "in_review";
}
