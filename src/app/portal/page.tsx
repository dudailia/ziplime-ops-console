import type { Metadata } from "next";
import { Suspense } from "react";
import { PortalDefault, PortalFromAddress } from "@/components/portal/PortalView";

export const metadata: Metadata = { title: "Dry-run review" };

export default function PortalPage() {
  return (
    // The server renders the view with no query; the browser swaps in the one for its address.
    <Suspense fallback={<PortalDefault />}>
      <PortalFromAddress />
    </Suspense>
  );
}
