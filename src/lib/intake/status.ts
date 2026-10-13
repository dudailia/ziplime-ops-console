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

export function intakeHits(state: State, s: Signup): { subject: GuardHit[]; body: GuardHit[] } {
  const rec = state.intake[s.id];
  const email = currentEmail(s, rec);
  const opts = { intake: true, otherClients: intakeOthers(state, s.id) };
  return { subject: guard(email.subject, opts).hits, body: guard(email.body, opts).hits };
}

export function intakeStatus(state: State, s: Signup): IntakeStatus {
  const rec = state.intake[s.id];
  if (rec?.decision) return rec.decision.kind;
  const h = intakeHits(state, s);
  return h.subject.length + h.body.length > 0 ? "flagged" : "review";
}

