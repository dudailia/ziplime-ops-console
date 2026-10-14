import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { AccountDetail } from "@/components/ops/AccountDetail";
import { SEED_ACCOUNTS } from "@/lib/seed";

export async function generateMetadata({ params }: PageProps<"/ops/accounts/[id]">): Promise<Metadata> {
  const { id } = await params;
  const a = SEED_ACCOUNTS.find((x) => x.id === id);
  return { title: a ? `${a.trader}${a.company ? `, ${a.company}` : ""}` : "Account" };
}

// Seeded accounts prerender; accounts approved from intake live in the
// browser and render on the client.
export function generateStaticParams() {
  return SEED_ACCOUNTS.map((a) => ({ id: a.id }));
}

export default function AccountPage() {
  return (
    <Suspense fallback={<PageSkeleton label="Loading the account…" />}>
      <AccountDetail />
    </Suspense>
  );
}
