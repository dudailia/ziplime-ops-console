// The demo's mutable state: everything a person can change. Seed data stays
// in lib/seed and is never copied in here. Pure reducer, so it is testable.

import type { Account } from "../seed";

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

export type State = {
  v: 1;
  /** Claude's answers for reasons with no built-in rule, keyed by reason string. */
  explainCache: Record<string, string>;
  /** Accounts created by approving a Beta signup. */
  extraAccounts: Account[];
  activity: Activity[];
};

export type Action =
  | { type: "hydrate"; state: State }
  | { type: "reset" }
  | { type: "explain/cache"; reason: string; text: string };

export function initialState(): State {
  return { v: 1, explainCache: {}, extraAccounts: [], activity: [] };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "hydrate":
      return action.state;
    case "reset":
      return initialState();
    case "explain/cache":
      return { ...state, explainCache: { ...state.explainCache, [action.reason]: action.text } };
  }
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
