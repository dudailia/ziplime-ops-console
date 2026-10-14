"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DeploymentSummary } from "@/lib/crm";
import { useDataset } from "@/lib/data/DatasetProvider";
import type { IngestBatchView } from "@/lib/data/types";
import { stampET } from "@/lib/format";
import { Button, Panel } from "@/components/ui/kit";
import { IngestSetup } from "./IngestSetup";

const STATUS: Record<IngestBatchView["status"], string> = {
  stored: "Stored",
  replay: "Resent, nothing new",
  stale: "Refused: old timestamp",
  bad_request: "Refused: bad body",
  gap: "Refused: lines missing before it",
};

function Lines({ b }: { b: IngestBatchView }) {
  if (b.status !== "stored" && b.status !== "replay") return <span className="text-ink-3">{STATUS[b.status]}</span>;
  const last = (b.firstLine ?? 0) + b.lineCount - 1;
  if (b.status === "replay") {
    return (
      <span className="tabular-nums text-ink-2">
        Lines {b.firstLine} to {last}: the same batch again, nothing new
      </span>
    );
  }
  return (
    <span className="tabular-nums">
      Lines {b.firstLine} to {last}: {b.accepted} new
      {b.duplicate > 0 && `, ${b.duplicate} already stored`}
      {b.rejected > 0 && <span className="font-semibold text-refuse">, {b.rejected} rejected</span>}
      {b.ignored > 0 && `, ${b.ignored} blank`}
    </span>
  );
}

function RotateKey({ deploymentId }: { deploymentId: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "confirm" | "busy">("idle");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rotate = async () => {
    setStep("busy");
    setError(null);
    try {
      const res = await fetch(`/api/ops/deployments/${deploymentId}/key`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body = (await res.json()) as { secret?: string; error?: string };
      if (!res.ok || !body.secret) throw new Error(body.error ?? `HTTP ${res.status}`);
      setSecret(body.secret);
      router.refresh();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Request failed");
    } finally {
      setStep("idle");
    }
  };

  if (secret) return <IngestSetup deploymentId={deploymentId} secret={secret} />;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {step === "confirm" ? (
        <>
          <span className="text-[12px] text-ink-2">The current key stops working at once.</span>
          <Button kind="primary" onClick={rotate}>
            Issue the new key
          </Button>
          <Button kind="quiet" onClick={() => setStep("idle")}>
            Cancel
          </Button>
        </>
      ) : (
        <Button onClick={() => setStep("confirm")} disabled={step === "busy"}>
          {step === "busy" ? "Issuing…" : "Issue a new key"}
        </Button>
      )}
      {error && <span className="text-[12px] text-refuse">Couldn&apos;t issue a key: {error}</span>}
    </div>
  );
}

/** Database mode: what the forwarder sent for each deployment, newest first, and every rejected line. */
export function IngestPanel({ deployments }: { deployments: DeploymentSummary[] }) {
  const ds = useDataset();
  if (ds.source !== "postgres") return null;
  return (
    <Panel title="Ingest" aside="Batches from the forwarder, newest first">
      {deployments.length === 0 && <p className="px-4 py-3 text-[13px] text-ink-2">No deployments yet.</p>}
      {deployments.map(({ deployment: d }) => {
        const batches = ds.ingest[d.id] ?? [];
        const rejected = batches.flatMap((b) => b.rejectedLines.map((l) => ({ ...l, at: b.receivedAt })));
        return (
          <div key={d.id} data-testid={`ingest-${d.id}`} className="border-b border-rule px-4 py-3 last:border-b-0">
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[13px] font-semibold text-ink">{d.strategy}</span>
              <code className="font-mono text-[12px] text-ink-3">{d.id}</code>
              <span className="ml-auto">
                <RotateKey deploymentId={d.id} />
              </span>
            </div>
            {batches.length === 0 ? (
              <p className="text-[13px] text-ink-2">No batches yet. Start the forwarder with this deployment&apos;s key, and each batch shows up here.</p>
            ) : (
              <ul className="text-[13px]">
                {batches.map((b) => (
                  <li key={b.id} className="row grid grid-cols-[1fr_auto] gap-x-3 border-t border-rule py-1.5 first:border-t-0 sm:grid-cols-[9rem_1fr_auto]">
                    <span className="text-[12px] text-ink-3 sm:col-start-1 sm:row-start-1 sm:pt-px">{stampET(b.receivedAt)}</span>
                    <span className="col-span-2 row-start-2 min-w-0 text-ink sm:col-span-1 sm:col-start-2 sm:row-start-1">
                      <Lines b={b} />
                    </span>
                    {b.file ? <code className="truncate text-right font-mono text-[12px] text-ink-3 sm:col-start-3 sm:row-start-1">{b.file}</code> : <span />}
                  </li>
                ))}
              </ul>
            )}
            {rejected.length > 0 && (
              <div className="mt-2 rounded-[2px] border border-rule bg-sunk px-3 py-2">
                <p className="text-[12px] font-semibold text-ink">Rejected lines</p>
                <ul className="mt-1 text-[12px] text-ink-2">
                  {rejected.map((l) => (
                    <li key={`${l.at}-${l.line}`}>
                      <span className="tabular-nums font-semibold text-ink">Line {l.line}</span>: {l.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </Panel>
  );
}
