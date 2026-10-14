"use client";

import { useMemo } from "react";
import { useDataset } from "../data/DatasetProvider";
import { intakeStatus } from "../intake/status";
import type { Ticket } from "../inbox";
import { ticketStatus } from "../inbox/status";
import { allTickets } from "./state";
import { useStore } from "./StoreProvider";

export function useTickets(): Ticket[] {
  const { state } = useStore();
  const ds = useDataset();
  return useMemo(() => allTickets(ds, state), [ds, state]);
}

/** Counts on the nav: signups waiting for a person, replies waiting for approval. */
export function useNavBadges(): { intake: number; inbox: number } {
  const { state } = useStore();
  const ds = useDataset();
  return useMemo(() => {
    const intake = ds.signups.filter((s) => {
      const st = intakeStatus(ds, state, s);
      return st === "review" || st === "flagged";
    }).length;
    const inbox = allTickets(ds, state).filter((t) => ticketStatus(ds, state, t) !== "replied").length;
    return { intake, inbox };
  }, [ds, state]);
}

/** Tickets waiting on Limex (a reply or a review), per account id. */
export function useOpenTicketCounts(): Record<string, number> {
  const { state } = useStore();
  const ds = useDataset();
  return useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of allTickets(ds, state)) if (ticketStatus(ds, state, t) !== "replied") out[t.accountId] = (out[t.accountId] ?? 0) + 1;
    return out;
  }, [ds, state]);
}
