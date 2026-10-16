import type { Metadata } from "next";
import { Suspense } from "react";
import { InboxDefault, InboxFromAddress } from "@/components/ops/InboxView";

export const metadata: Metadata = { title: "Support inbox" };

export default function InboxPage() {
  return (
    // The server renders the view with no query; the browser swaps in the one for its address.
    <Suspense fallback={<InboxDefault />}>
      <InboxFromAddress />
    </Suspense>
  );
}
