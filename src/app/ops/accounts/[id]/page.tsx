import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { AccountDetail } from "@/components/ops/AccountDetail";
import { serverDataset } from "@/lib/data/server";
import { STATIC_DATASET } from "@/lib/data/static";

export async function generateMetadata({ params }: PageProps<"/ops/accounts/[id]">): Promise<Metadata> {
  const { id } = await params;
  const a = (await serverDataset()).accounts.find((x) => x.id === id);
  return { title: a ? `${a.trader}${a.company ? `, ${a.company}` : ""}` : "Account" };
}

// Seeded accounts prerender; accounts approved from intake live in the
// browser and render on the client. Cache Components rejects an empty list,
// so this stays on the seed ids in database mode too, where every page
// renders at request time anyway.
export function generateStaticParams() {
  return STATIC_DATASET.accounts.map((a) => ({ id: a.id }));
}

export default function AccountPage() {
  return (
    <Suspense fallback={<PageSkeleton label="Loading the account…" />}>
      <AccountDetail />
    </Suspense>
  );
}
