import type { Metadata } from "next";
import { Suspense } from "react";
import { IntakeView } from "@/components/ops/IntakeView";

export const metadata: Metadata = { title: "Beta intake" };

export default function IntakePage() {
  return (
    <Suspense fallback={<p className="text-[13px] text-ink-2">Loading signups…</p>}>
      <IntakeView />
    </Suspense>
  );
}
