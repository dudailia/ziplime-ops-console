"use client";

import { useMemo } from "react";
import { summarizeAccount, type AccountSummary } from "../crm";
import { SEED_ACCOUNTS, type Account } from "../seed";
import { useStore } from "./StoreProvider";

export function useAccounts(): Account[] {
  const { state } = useStore();
  return useMemo(() => [...SEED_ACCOUNTS, ...state.extraAccounts], [state.extraAccounts]);
}

export function useAccountSummaries(): AccountSummary[] {
  const accounts = useAccounts();
  return useMemo(() => accounts.map(summarizeAccount), [accounts]);
}
