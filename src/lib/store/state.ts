// The demo's mutable state: everything a person can change. Seed data stays
// in lib/seed and is never copied in here. Pure reducer, so it is testable.

import { otherClients } from "../crm";
import { guard } from "../guard";
import { SEED_TICKETS, type Message, type ReplySource, type Ticket } from "../inbox";
import { accountFromSignup, signupById, SIGNUPS } from "../intake";
import type { Triage } from "../intake/triage";
import { SEED_ACCOUNTS, type Account } from "../seed";

export const STORAGE_KEY = "ziplime-ops-console:v1";

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
  | { type: "activity/add"; entries: Activity[] };

export function initialState(): State {
  return { v: 1, explainCache: {}, extraAccounts: [], activity: [], intake: {}, createdTickets: [], replies: {}, sent: {} };
}

export function reducer(state: State, action: Action): State {
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
      return approveSignup(state, action);
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
      return approveReply(state, action);
    case "tickets/create": {
      const known = new Set(allTickets(state).map((t) => t.id));
      const fresh = action.tickets.filter((t) => !known.has(t.id));
      return { ...state, createdTickets: [...state.createdTickets, ...fresh], activity: [...state.activity, ...action.activity] };
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

export function allAccounts(state: State): Account[] {
  return [...SEED_ACCOUNTS, ...state.extraAccounts];
}

/** Identifiers the welcome email to this signup must not mention. */
export function intakeOthers(state: State, signupId: string): string[] {
  const others = SIGNUPS.filter((s) => s.id !== signupId).map((s) => s.email);
  return [...otherClients("", allAccounts(state)), ...others];
}

// Approving creates exactly one Beta account, and only if the email passes the guard.
function approveSignup(state: State, action: Extract<Action, { type: "intake/approve" }>): State {
  const signup = signupById(action.id);
  if (!signup || state.intake[action.id]?.decision) return state;
  if (state.extraAccounts.some((a) => a.fromIntake === action.id)) return state;
  const text = `${action.email.subject}\n${action.email.body}`;
  if (!guard(text, { intake: true, otherClients: intakeOthers(state, action.id) }).ok) return state;
  const account = accountFromSignup(signup, allAccounts(state).map((a) => a.id), action.at);
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

export function allTickets(state: State): Ticket[] {
  return [...SEED_TICKETS, ...state.createdTickets];
}

/** The draft on a ticket: this session's reply, else a seeded draft, else nothing. */
export function currentReply(state: State, ticket: Ticket): Reply | null {
  if (ticket.id in state.replies) return state.replies[ticket.id];
  if (ticket.draft) return { text: ticket.draft.text, source: "human", by: ticket.draft.by, updatedAt: ticket.createdAt };
  return null;
}

export function replyHits(state: State, ticket: Ticket, text: string) {
  return guard(text, { otherClients: otherClients(ticket.accountId, allAccounts(state)) }).hits;
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
function approveReply(state: State, action: Extract<Action, { type: "reply/approve" }>): State {
  const ticket = allTickets(state).find((t) => t.id === action.ticketId);
  if (!ticket) return state;
  const reply = currentReply(state, ticket);
  if (!reply || replyStatusOf(state, ticket, reply.text) !== "in_review") return state;
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

function replyStatusOf(state: State, ticket: Ticket, text: string) {
  if (text.trim() === "") return "empty";
  return replyHits(state, ticket, text).length > 0 ? "flagged" : "in_review";
}
