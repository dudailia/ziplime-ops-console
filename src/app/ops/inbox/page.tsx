import type { Metadata } from "next";
import { Suspense } from "react";
import { pageFiles } from "@/lib/data/pageFiles";
import { WithFiles } from "@/lib/data/WithFiles";
import { InboxDefault, InboxFromAddress } from "@/components/ops/InboxView";

export const metadata: Metadata = { title: "Support inbox" };

export default function InboxPage() {
  return (
    // Every file: any ticket can be opened, and its detail reads its account's files.
    <WithFiles files={pageFiles()}>
      {/* The server renders the view with no query; the browser swaps in the one for its address. */}
      <Suspense fallback={<InboxDefault />}>
        <InboxFromAddress />
      </Suspense>
    </WithFiles>
  );
}
