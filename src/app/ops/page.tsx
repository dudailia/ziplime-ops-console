import type { Metadata } from "next";
import { AccountsView } from "@/components/ops/AccountsView";

export const metadata: Metadata = { title: "Accounts" };

export default function OpsPage() {
  return <AccountsView />;
}
