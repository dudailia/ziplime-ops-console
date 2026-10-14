import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { PortalView } from "@/components/portal/PortalView";

export const metadata: Metadata = { title: "Dry-run review" };

export default function PortalPage() {
  return (
    <Suspense fallback={<PageSkeleton label="Loading the dry-run file…" />}>
      <PortalView />
    </Suspense>
  );
}
