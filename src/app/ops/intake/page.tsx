import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { IntakeView } from "@/components/ops/IntakeView";

export const metadata: Metadata = { title: "Beta intake" };

export default function IntakePage() {
  return (
    <Suspense fallback={<PageSkeleton label="Loading signups…" />}>
      <IntakeView />
    </Suspense>
  );
}
