import type { Metadata } from "next";
import { AutomationsView } from "@/components/ops/AutomationsView";

export const metadata: Metadata = { title: "Automations" };

export default function AutomationsPage() {
  return <AutomationsView />;
}
