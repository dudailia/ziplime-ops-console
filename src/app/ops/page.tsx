import type { Metadata } from "next";
import { AccountsView } from "@/components/ops/AccountsView";
import { WithFiles } from "@/lib/data/WithFiles";

export const metadata: Metadata = { title: "Accounts" };

// Every account's health comes from its deployments' files.
export default function OpsPage() {
  return (
    <WithFiles all>
      <AccountsView />
    </WithFiles>
  );
}
