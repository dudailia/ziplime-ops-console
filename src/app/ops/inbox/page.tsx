import type { Metadata } from "next";
import { Suspense } from "react";
import { InboxView } from "@/components/ops/InboxView";

export const metadata: Metadata = { title: "Support inbox" };

export default function InboxPage() {
  return (
    <Suspense fallback={<p className="text-[13px] text-ink-2">Loading tickets…</p>}>
      <InboxView />
    </Suspense>
  );
}
