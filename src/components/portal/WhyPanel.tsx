"use client";

import { useState } from "react";
import { explain, needsClaude, splitReason, type Profile } from "@/lib/dryrun/explain";
import type { RefuseEvent, SkipEvent } from "@/lib/dryrun/types";
import { CATEGORY_LABEL, type GuardHit } from "@/lib/guard";
import { useAiStatus } from "@/lib/ai/useAiStatus";
import { useStore } from "@/lib/store/StoreProvider";
import { AiOffNote, Button, Env } from "@/components/ui/kit";

function Setting({ value }: { value: string }) {
  // Env var names and code identifiers in mono, plain words as text.
  const parts = value.split(/(\b(?:ZIPLIME|LIME)_[A-Z_]+\b|validate_order|LOT_SIZE = 1|assets\.sqlite)/);
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <Env key={i}>{p}</Env> : <span key={i}>{p}</span>))}
    </>
  );
}

function AskClaude({ event, profile }: { event: RefuseEvent | SkipEvent; profile: Profile | null }) {
  const ai = useAiStatus();
  const { state, dispatch } = useStore();
  const cached = state.explainCache[event.reason];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<GuardHit[]>([]);

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: event.reason,
          event: event.event,
          symbol: event.symbol,
          requestedAmount: event.requested_amount,
          riskEnv: profile?.riskEnv ?? null,
          validateOrders: profile?.validateOrders ?? null,
        }),
      });
      const body = (await res.json()) as { text?: string; hits?: GuardHit[]; error?: string };
      if (!res.ok || !body.text) throw new Error(body.error ?? `Request failed (${res.status})`);
      setHits(body.hits ?? []);
      if ((body.hits ?? []).length === 0) dispatch({ type: "explain/cache", reason: event.reason, text: body.text });
      else setError("Claude's answer tripped the guard, so it isn't shown. Try again.");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  if (cached) {
    return (
      <div className="border-l-2 border-accent bg-accent-soft/50 px-3 py-2">
        <div className="text-[12px] font-semibold text-accent">Claude&apos;s reading. Not a built-in rule, so check it.</div>
        <p className="mt-1 max-w-[70ch] text-[13px] text-ink">{cached}</p>
      </div>
    );
  }
  if (ai === null) return <p className="text-[12px] text-ink-3">Checking whether AI is on…</p>;
  if (!ai.enabled) return <AiOffNote>The raw reason above is everything the file says.</AiOffNote>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={ask} disabled={busy}>
        {busy ? "Asking Claude…" : "Ask Claude"}
      </Button>
      <span className="text-[12px] text-ink-3">Sends only this reason, the symbol and the deployment&apos;s risk profile.</span>
      {error && <p className="w-full text-[12px] text-refuse">{error}</p>}
      {hits.length > 0 && <p className="w-full text-[12px] text-ink-3">{hits.map((h) => CATEGORY_LABEL[h.category]).join(", ")}</p>}
    </div>
  );
}

export function WhyPanel({ event, profile }: { event: RefuseEvent | SkipEvent; profile: Profile | null }) {
  const x = explain(event, profile);
  const { type } = splitReason(event.reason);
  return (
    <div className="flex flex-col gap-2.5">
      {x ? (
        <>
          <h3 className="t-semi text-[15px] font-semibold text-ink">{x.title}</h3>
          <p className="max-w-[72ch] text-[13px] text-ink">{x.happened}</p>
          <dl className="grid max-w-[80ch] grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            {x.setting && (
              <>
                <dt className="text-ink-2">Setting</dt>
                <dd>
                  <Setting value={x.setting} />
                </dd>
              </>
            )}
            <dt className="text-ink-2">{x.kind === "benign" ? "Do" : "Change"}</dt>
            <dd className="text-ink">{x.change}</dd>
          </dl>
        </>
      ) : (
        <>
          <h3 className="t-semi text-[15px] font-semibold text-ink">No built-in explanation</h3>
          <p className="text-[13px] text-ink-2">
            This reason matches none of the engine messages the console knows. {type ? `It's a ${type}.` : ""}
          </p>
        </>
      )}
      <div className="text-[12px] text-ink-2">
        Reason, as written by the engine
        <pre className="mt-1 whitespace-pre-wrap break-words bg-sunk px-2 py-1.5 font-mono text-[12px] text-ink">{event.reason}</pre>
      </div>
      {needsClaude(x) && <AskClaude event={event} profile={profile} />}
    </div>
  );
}
