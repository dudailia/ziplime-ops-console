"use client";

import { useMemo } from "react";
import { SIGNUPS } from "../intake";
import { intakeStatus } from "../intake/status";
import type { Ticket } from "../inbox";
import { allTickets, needsReply } from "./state";
import { useStore } from "./StoreProvider";

export function useTickets(): Ticket[] {
  const { state } = useStore();
  return useMemo(() => allTickets(state), [state]);
}

/** Counts on the nav: signups waiting for a person, replies waiting for approval. */
export function useNavBadges(): { intake: number; inbox: number } {
  const { state } = useStore();
  return useMemo(() => {
    const intake = SIGNUPS.filter((s) => {
      const st = intakeStatus(state, s);
      return st === "review" || st === "flagged";
    }).length;
    const inbox = allTickets(state).filter((t) => needsReply(state, t)).length;
    return { intake, inbox };
  }, [state]);
}

/** Tickets waiting on a Limex reply, per account id. */
export function useOpenTicketCounts(): Record<string, number> {
  const { state } = useStore();
  return useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of allTickets(state)) if (needsReply(state, t)) out[t.accountId] = (out[t.accountId] ?? 0) + 1;
    return out;
  }, [state]);
}
