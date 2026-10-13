"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Profile } from "@/lib/dryrun/explain";
import type { ParsedFile } from "@/lib/dryrun/types";
import { DEPLOYMENTS, deploymentById, seedFile, SEED_ACCOUNTS, type Deployment } from "@/lib/seed";
import { useStore } from "@/lib/store/StoreProvider";
import { Env, PageTitle, Panel } from "@/components/ui/kit";
import { OrderTape, emptyFilter, type TapeFilter } from "./OrderTape";
import { EventCounts, NetShares, Readiness, SessionStrip, WhySummary } from "./parts";
import { SessionClock } from "./SessionClock";
import { DropZone, ParseReport, UploadButton } from "./UploadDrop";

const DEFAULT_DEPLOYMENT = "priya-growth";
const UPLOAD_PREFIX = "file:";

export function profileOf(d: Deployment | undefined): Profile | null {
  return d ? { riskEnv: d.riskEnv, validateOrders: d.validateOrders } : null;
}

function RiskProfile({ deployment }: { deployment: Deployment }) {
  const env = deployment.riskEnv;
  return (
    <div className="flex flex-col gap-1.5 text-[12px] text-ink-2">
      {env ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {Object.entries(env).map(([k, v]) => (
            <li key={k}>
              <Env>
                {k}=<span className="font-medium">{v}</span>
              </Env>
            </li>
          ))}
        </ul>
      ) : (
        <p>No fail-closed risk profile: the engine ran with no ZIPLIME_* order limits.</p>
      )}
      <p>
        <Env>validate_orders={deployment.validateOrders ? "True" : "False"}</Env>
        {deployment.validateOrders ? " Every order was checked by Lime before it was written." : " Lime was never asked, so this run proves less."}
      </p>
    </div>
  );
}

export function PortalView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { uploads, addUpload } = useStore();

  const d = params.get("d") ?? DEFAULT_DEPLOYMENT;
  const upload = d.startsWith(UPLOAD_PREFIX) ? uploads.find((u) => u.source === d.slice(UPLOAD_PREFIX.length)) : undefined;
  const deployment = upload ? undefined : deploymentById(d) ?? deploymentById(DEFAULT_DEPLOYMENT);
  const file: ParsedFile = useMemo(() => upload ?? seedFile(deployment!.id), [upload, deployment]);
  const profile = profileOf(deployment);
  const account = deployment ? SEED_ACCOUNTS.find((a) => a.id === deployment.account) : undefined;

  const sDate = params.get("s");
  const session = file.sessions.find((s) => s.date === sDate) ?? file.sessions[file.sessions.length - 1];

  const [selected, setSelected] = useState<number | null>(null);
  const [filter, setFilter] = useState<TapeFilter>(emptyFilter);
  useEffect(() => {
    setSelected(null);
    setFilter(emptyFilter());
  }, [file, session?.date]);

  const go = (next: { d?: string; s?: string | null }) => {
    const q = new URLSearchParams(params.toString());
    if (next.d !== undefined) {
      q.set("d", next.d);
      q.delete("s");
    }
    if (next.s !== undefined) {
      if (next.s === null) q.delete("s");
      else q.set("s", next.s);
    }
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  const onLoaded = (f: ParsedFile) => {
    addUpload(f);
    go({ d: `${UPLOAD_PREFIX}${f.source}` });
  };

  const byAccount = SEED_ACCOUNTS.map((a) => ({ a, ds: DEPLOYMENTS.filter((x) => x.account === a.id) }));
  const missingUpload = d.startsWith(UPLOAD_PREFIX) && !upload;

  return (
    <DropZone onLoaded={onLoaded}>
      <PageTitle
        title="Dry-run review"
        sub="What the strategy would have sent to Lime, and why the rest didn't go out. Every line here was written by ziplime's dry-run mode."
      >
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <span className="sr-only sm:not-sr-only">Deployment</span>
          <select
            value={upload ? d : deployment!.id}
            onChange={(ev) => go({ d: ev.target.value })}
            className="max-w-[min(80vw,340px)] rounded-sm border border-rule-strong bg-surface px-2 py-1.5 text-[13px] font-semibold text-ink"
          >
            {uploads.length > 0 && (
              <optgroup label="Opened in this tab">
                {uploads.map((u) => (
                  <option key={u.source} value={`${UPLOAD_PREFIX}${u.source}`}>
                    {u.source}
                  </option>
                ))}
              </optgroup>
            )}
            {byAccount.map(({ a, ds }) => (
              <optgroup key={a.id} label={a.company ? `${a.trader}, ${a.company}` : a.trader}>
                {ds.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.strategy}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <UploadButton onLoaded={onLoaded} />
      </PageTitle>

      {missingUpload && (
        <p className="mb-4 border border-rule bg-surface px-4 py-3 text-[13px] text-ink-2">
          That file was opened in another tab or before a reload. Opened files stay in memory only. Showing a seeded deployment instead.
        </p>
      )}

      <div className="mb-4 flex flex-col gap-3 border border-rule bg-surface px-4 py-3 lg:flex-row lg:items-start lg:gap-8">
        <div className="min-w-0 lg:w-[34%]">
          <div className="t-semi text-[17px] font-semibold text-ink">{deployment ? deployment.strategy : file.source}</div>
          <p className="text-[13px] text-ink-2">
            {deployment ? deployment.description : "Opened from your computer. Read in the browser; nothing was uploaded."}
          </p>
          <p className="mt-1 text-[12px] text-ink-3">
            {account ? (
              <>
                {account.trader}
                {account.company ? `, ${account.company}` : ""}. The file masks the account as{" "}
                <Env>{file.accounts[0] ?? "null"}</Env>.{" "}
                <Link className="underline" href={`/ops/accounts/${account.id}`}>
                  Ops view
                </Link>
              </>
            ) : (
              <>
                Accounts in the file: {file.accounts.length ? file.accounts.map((a) => <Env key={a}>{a} </Env>) : "none recorded"}.
              </>
            )}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          {deployment ? (
            <RiskProfile deployment={deployment} />
          ) : (
            <p className="text-[12px] text-ink-2">The risk profile isn&apos;t in the file, so explanations use the reason text alone.</p>
          )}
        </div>
      </div>

      <ParseReport file={file} />

      {!session ? (
        <Panel title="No sessions in this file">
          <p className="px-4 py-3 text-[13px] text-ink-2">
            {file.errors.length > 0 ? "No line could be read. See the errors above." : "The file is empty. Run a strategy with dry_run_file set, then open the file here."}
          </p>
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          <SessionStrip sessions={file.sessions} current={session.date} onPick={(s) => go({ s })} />
          <SessionClock session={session} selected={selected} onSelect={(line) => setSelected(line)} />
          <EventCounts session={session} />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="flex min-w-0 flex-col gap-4 xl:col-span-8">
              <WhySummary
                session={session}
                profile={profile}
                activeGroup={filter.group}
                onGroup={(group) => setFilter({ ...emptyFilter(), group })}
              />
              <Panel title="Order tape" aside="Tap a row for the raw line and the explanation">
                <OrderTape session={session} profile={profile} selected={selected} onSelect={setSelected} filter={filter} setFilter={setFilter} />
              </Panel>
            </div>
            <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
              <NetShares session={session} />
              <Readiness file={file} profile={profile} />
            </div>
          </div>
        </div>
      )}
    </DropZone>
  );
}
