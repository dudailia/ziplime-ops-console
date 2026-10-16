import type { Metadata } from "next";
import { AccountsView } from "@/components/ops/AccountsView";
import { WithFiles } from "@/lib/data/WithFiles";
import { pageFiles } from "@/lib/data/pageFiles";

export const metadata: Metadata = { title: "Accounts" };

// Every account's health comes from its deployments' files.
export default function OpsPage() {
  return (
    <WithFiles files={pageFiles()}>
      <AccountsView />
    </WithFiles>
  );
}
