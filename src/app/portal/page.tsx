import type { Metadata } from "next";
import { Suspense } from "react";
import { pageFiles } from "@/lib/data/pageFiles";
import { WithFiles } from "@/lib/data/WithFiles";
import { PortalDefault, PortalFromAddress } from "@/components/portal/PortalView";

export const metadata: Metadata = { title: "Dry-run review" };

export default function PortalPage() {
  return (
    // Every file: the deployment picker switches between all 14 without a server round trip.
    <WithFiles files={pageFiles()}>
      {/* The server renders the view with no query; the browser swaps in the one for its address. */}
      <Suspense fallback={<PortalDefault />}>
        <PortalFromAddress />
      </Suspense>
    </WithFiles>
  );
}
