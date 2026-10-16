import type { Metadata } from "next";
import { AutomationsView } from "@/components/ops/AutomationsView";
import { WithFiles } from "@/lib/data/WithFiles";
import { pageFiles } from "@/lib/data/pageFiles";

export const metadata: Metadata = { title: "Automations" };

// The rules run over every deployment's file.
export default function AutomationsPage() {
  return (
    <WithFiles files={pageFiles()}>
      <AutomationsView />
    </WithFiles>
  );
}
