import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { InboxView } from "@/components/ops/InboxView";

export const metadata: Metadata = { title: "Support inbox" };

export default function InboxPage() {
  return (
    <Suspense fallback={<PageSkeleton label="Loading tickets…" />}>
      <InboxView />
    </Suspense>
  );
}
