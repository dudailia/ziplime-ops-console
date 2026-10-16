import type { Metadata } from "next";
import { Suspense } from "react";
import { IntakeDefault, IntakeFromAddress } from "@/components/ops/IntakeView";

export const metadata: Metadata = { title: "Beta intake" };

export default function IntakePage() {
  return (
    // The server renders the view with no query; the browser swaps in the one for its address.
    <Suspense fallback={<IntakeDefault />}>
      <IntakeFromAddress />
    </Suspense>
  );
}
