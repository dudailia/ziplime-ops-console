import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { AccountDetail } from "@/components/ops/AccountDetail";
import { connection } from "next/server";
import { BUILD_MODE, serverDataset } from "@/lib/data/server";
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

// Database mode reads the title at request time; this tells Next.js that is
// on purpose. It renders nothing, and a static build never includes it.
async function RequestTime() {
  await connection();
  return null;
}

export default function AccountPage() {
  return (
    <>
      <Suspense fallback={<PageSkeleton label="Loading the account…" />}>
        <AccountDetail />
      </Suspense>
      {BUILD_MODE === "database" && (
        <Suspense>
          <RequestTime />
        </Suspense>
      )}
    </>
  );
}
