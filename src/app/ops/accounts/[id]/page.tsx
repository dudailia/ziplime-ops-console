import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountDetail } from "@/components/ops/AccountDetail";
import { SEED_ACCOUNTS } from "@/lib/seed";

export const metadata: Metadata = { title: "Account" };

// Seeded accounts prerender; accounts approved from intake live in the
// browser and render on the client.
export function generateStaticParams() {
  return SEED_ACCOUNTS.map((a) => ({ id: a.id }));
}

export default function AccountPage() {
  return (
    <Suspense fallback={<p className="text-[13px] text-ink-2">Loading the account…</p>}>
      <AccountDetail />
    </Suspense>
  );
}
