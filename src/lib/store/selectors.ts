"use client";

import { useMemo } from "react";
import { SIGNUPS } from "../intake";
import { intakeStatus } from "../intake/status";
import { useStore } from "./StoreProvider";

/** Counts on the nav: signups waiting for a person, replies waiting for approval. */
export function useNavBadges(): { intake: number; inbox: number } {
  const { state } = useStore();
  return useMemo(() => {
    const intake = SIGNUPS.filter((s) => {
      const st = intakeStatus(state, s);
      return st === "review" || st === "flagged";
    }).length;
    return { intake, inbox: 0 };
  }, [state]);
}

/** Open tickets per account id. */
export function useOpenTicketCounts(): Record<string, number> {
  useStore();
  return {};
}
