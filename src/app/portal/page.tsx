import type { Metadata } from "next";
import { Suspense } from "react";
import { PortalView } from "@/components/portal/PortalView";

export const metadata: Metadata = { title: "Dry-run review" };

export default function PortalPage() {
  return (
    <Suspense fallback={<p className="text-[13px] text-ink-2">Loading the dry-run file…</p>}>
      <PortalView />
    </Suspense>
  );
}
