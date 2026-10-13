"use client";

import { useStore } from "./StoreProvider";

/** Counts on the nav: signups waiting for a person, replies waiting for approval. */
export function useNavBadges(): { intake: number; inbox: number } {
  useStore();
  return { intake: 0, inbox: 0 };
}
