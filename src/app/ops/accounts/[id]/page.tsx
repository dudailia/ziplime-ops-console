import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { AccountDetail } from "@/components/ops/AccountDetail";
import { connection } from "next/server";
import { BUILD_MODE, serverDataset } from "@/lib/data/server";
import { STATIC_DATASET } from "@/lib/data/static";
import { deploymentIdsOf, pageFiles } from "@/lib/data/pageFiles";
import { WithFiles } from "@/lib/data/WithFiles";

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

// The account page reads only its own deployments' files.
async function AccountFiles({ params, children }: { params: PageProps<"/ops/accounts/[id]">["params"]; children: React.ReactNode }) {
  const { id } = await params;
  return <WithFiles files={pageFiles(deploymentIdsOf(id))}>{children}</WithFiles>;
}

export default function AccountPage({ params }: PageProps<"/ops/accounts/[id]">) {
  return (
    <>
      <Suspense fallback={<PageSkeleton label="Loading the account…" />}>
        <AccountFiles params={params}>
          <AccountDetail />
        </AccountFiles>
      </Suspense>
      {BUILD_MODE === "database" && (
        <Suspense>
          <RequestTime />
        </Suspense>
      )}
    </>
  );
}
