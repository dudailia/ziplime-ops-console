"use client";

import { useState } from "react";
import { forwarderSetup, STARTER_PROFILE } from "@/lib/ingest/command";
import type { RiskEnv } from "@/lib/seed";
import { Check, Env } from "@/components/ui/kit";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="press shrink-0 rounded-[4px] border border-rule-strong bg-surface px-2 py-1 text-[12px] font-semibold text-ink hover:border-ink hover:bg-sunk"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // Clipboard blocked: the text is selectable on screen.
        }
      }}
    >
      {copied ? (
        <span className="inline-flex items-center gap-1 text-ok">
          <Check />
          Copied
        </span>
      ) : (
        "Copy"
      )}
    </button>
  );
}

function Block({ text, label }: { text: string; label: string }) {
  return (
    <div className="flex items-start gap-2">
      <pre className="min-w-0 flex-1 overflow-x-auto rounded-[4px] border border-rule bg-sunk px-3 py-2 font-mono text-[12px] leading-relaxed text-ink">{text}</pre>
      <CopyButton text={text} label={label} />
    </div>
  );
}

/**
 * The one time a deployment's ingest secret is on screen, with the exact
 * commands to start sending. The secret lives only in this component's
 * state: never in the store, browser storage or the URL.
 */
export function IngestSetup({ deploymentId, secret, profile = STARTER_PROFILE }: { deploymentId: string; secret: string; profile?: RiskEnv | null }) {
  const setup = forwarderSetup(typeof window === "undefined" ? "" : window.location.origin, deploymentId);
  const env = Object.entries(profile ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  return (
    <div data-testid="ingest-setup" className="flex flex-col gap-3 rounded-[4px] border border-accent-edge bg-surface p-3 text-[13px]">
      <div>
        <p className="font-semibold text-ink">
          Ingest key for <Env>{deploymentId}</Env>
        </p>
        <p className="text-[12px] text-ink-2">This is the only time the console shows it. Copy it now; if it&apos;s lost, issue a new one on the account page.</p>
      </div>
      <Block text={secret} label="Copy the ingest key" />
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-ink-2 marker:text-ink-3">
        <li>
          Save the key where only you can read it. Run this, paste the key, press Enter, then Ctrl-D:
          <div className="mt-1.5">
            <Block text={setup.save} label="Copy the save command" />
          </div>
        </li>
        <li>
          Run ziplime in dry run with <Env>dry_run_file=&quot;run/{deploymentId}.jsonl&quot;</Env> and this starting risk profile:
          <div className="mt-1.5">
            <Block text={env} label="Copy the risk profile" />
          </div>
        </li>
        <li>
          Start the forwarder next to it. It sends new lines as they are written and resumes where it stopped:
          <div className="mt-1.5">
            <Block text={setup.run} label="Copy the forwarder command" />
          </div>
        </li>
      </ol>
      <p className="text-[12px] text-ink-3">Batches show up on the account page as they arrive, with any rejected line and the reason.</p>
    </div>
  );
}
