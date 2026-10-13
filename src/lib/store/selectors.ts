"use client";

import { useMemo } from "react";
import { SIGNUPS } from "../intake";
import { intakeStatus } from "../intake/status";
import type { Ticket } from "../inbox";
import { ticketStatus } from "../inbox/status";
import { allTickets } from "./state";
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
    const inbox = allTickets(state).filter((t) => ticketStatus(state, t) !== "replied").length;
    return { intake, inbox };
  }, [state]);
}

/** Tickets waiting on Limex (a reply or a review), per account id. */
export function useOpenTicketCounts(): Record<string, number> {
  const { state } = useStore();
  return useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of allTickets(state)) if (ticketStatus(state, t) !== "replied") out[t.accountId] = (out[t.accountId] ?? 0) + 1;
    return out;
  }, [state]);
}
