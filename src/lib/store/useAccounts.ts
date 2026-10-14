"use client";

import { useMemo } from "react";
import { summarizeAccount, type AccountSummary } from "../crm";
import { useDataset } from "../data/DatasetProvider";
import type { Account } from "../seed";
import { mergeAccounts } from "./state";
import { useStore } from "./StoreProvider";

export function useAccounts(): Account[] {
  const { state } = useStore();
  const ds = useDataset();
  const extra = state.extraAccounts;
  return useMemo(() => mergeAccounts(ds.accounts, extra), [ds, extra]);
}

export function useAccountSummaries(): AccountSummary[] {
  const accounts = useAccounts();
  const ds = useDataset();
  return useMemo(() => accounts.map((a) => summarizeAccount(ds, a)), [ds, accounts]);
}
