import type { State } from "../store/state";
import { currentReply, needsReply, replyHits } from "../store/state";
import type { Ticket } from ".";

export type TicketStatus = "needs-reply" | "in-review" | "flagged" | "replied";

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  "needs-reply": "Needs reply",
  "in-review": "Draft in review",
  flagged: "Draft flagged",
  replied: "Replied",
};

export function ticketStatus(state: State, t: Ticket): TicketStatus {
  const reply = currentReply(state, t);
  if (reply && reply.text.trim()) return replyHits(state, t, reply.text).length ? "flagged" : "in-review";
  return needsReply(state, t) ? "needs-reply" : "replied";
}
