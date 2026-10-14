import type { Dataset } from "../data/types";
import { guard, type GuardHit } from "../guard";
import type { IntakeRecord, State } from "../store/state";
import { intakeOthers } from "../store/state";
import { rulesTriage, type Triage } from "./triage";
import type { Signup } from "./types";

export type IntakeStatus = "review" | "flagged" | "approved" | "dismissed";

export const STATUS_LABEL: Record<IntakeStatus, string> = {
  review: "Needs review",
  flagged: "Flagged",
  approved: "Approved",
  dismissed: "Dismissed",
};

export function activeTriage(s: Signup, rec: IntakeRecord | undefined): Triage {
  return rec?.use === "claude" && rec.claude ? rec.claude : rulesTriage(s);
}

export function currentEmail(s: Signup, rec: IntakeRecord | undefined) {
  return rec?.draft ?? activeTriage(s, rec).email;
}

export function intakeHits(ds: Dataset, state: State, s: Signup): { subject: GuardHit[]; body: GuardHit[] } {
  const rec = state.intake[s.id];
  const email = currentEmail(s, rec);
  const opts = { intake: true, otherClients: intakeOthers(ds, state, s.id) };
  return { subject: guard(email.subject, opts).hits, body: guard(email.body, opts).hits };
}

/** A decision stored in the database wins over one kept in this browser. */
export function decisionOf(ds: Dataset, state: State, id: string) {
  return ds.decisions[id] ?? state.intake[id]?.decision;
}

export function intakeStatus(ds: Dataset, state: State, s: Signup): IntakeStatus {
  const decision = decisionOf(ds, state, s.id);
  if (decision) return decision.kind;
  const h = intakeHits(ds, state, s);
  return h.subject.length + h.body.length > 0 ? "flagged" : "review";
}

