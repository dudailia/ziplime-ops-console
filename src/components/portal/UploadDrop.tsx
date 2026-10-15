"use client";

import { useRef, useState, type ReactNode } from "react";
import { parseDryRun } from "@/lib/dryrun/parse";
import type { ParsedFile } from "@/lib/dryrun/types";
import { Button } from "@/components/ui/kit";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Reads a dry-run file in the browser. Nothing is uploaded anywhere. */
export async function readDryRunFile(file: File): Promise<ParsedFile | string> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`;
  }
  try {
    return parseDryRun(await file.text(), file.name);
  } catch {
    return `${file.name} couldn't be read as text.`;
  }
}

export function UploadButton({ onLoaded }: { onLoaded: (file: ParsedFile) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <input
        ref={input}
        type="file"
        accept=".jsonl,.json,.txt,application/x-ndjson"
        className="sr-only"
        // The button below opens it, so it isn't a second tab stop.
        tabIndex={-1}
        aria-label="Dry-run file (.jsonl)"
        data-testid="upload-input"
        onChange={async (ev) => {
          const f = ev.target.files?.[0];
          ev.target.value = "";
          if (!f) return;
          const result = await readDryRunFile(f);
          if (typeof result === "string") setError(result);
          else {
            setError(null);
            onLoaded(result);
          }
        }}
      />
      <Button onClick={() => input.current?.click()}>Open a .jsonl file</Button>
      {error && <p className="text-[12px] text-refuse">{error}</p>}
    </div>
  );
}

/** Accepts a dropped file anywhere inside. */
export function DropZone({ onLoaded, children }: { onLoaded: (file: ParsedFile) => void; children: ReactNode }) {
  const [over, setOver] = useState(false);
  // A dropped file that can't be read used to vanish without a word.
  const [error, setError] = useState<string | null>(null);
  return (
    <div
      onDragOver={(ev) => {
        if (ev.dataTransfer.types.includes("Files")) {
          ev.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={(ev) => {
        if (ev.currentTarget === ev.target) setOver(false);
      }}
      onDrop={async (ev) => {
        ev.preventDefault();
        setOver(false);
        const f = ev.dataTransfer.files?.[0];
        if (!f) return;
        const result = await readDryRunFile(f);
        if (typeof result === "string") setError(result);
        else {
          setError(null);
          onLoaded(result);
        }
      }}
      // The "Open a .jsonl file" button sits inside the zone: a file picked there
      // replaces whatever a failed drop said.
      onChange={(ev) => {
        if (ev.target instanceof HTMLInputElement && ev.target.type === "file") setError(null);
      }}
      className={`relative ${over ? "outline-2 outline-dashed outline-offset-4 outline-ink" : ""}`}
    >
      {error && (
        <p role="alert" className="mb-3 text-[12px] text-refuse" data-testid="drop-error">
          {error}
        </p>
      )}
      {children}
    </div>
  );
}

export function ParseReport({ file }: { file: ParsedFile }) {
  if (file.errors.length === 0 && file.warnings.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-panel border border-refuse bg-surface" aria-label="Lines that couldn't be read">
      {file.errors.length > 0 && (
        <>
          <header className="border-b border-rule px-4 py-2.5">
            <h2 className="t-semi text-[15px] font-semibold text-refuse">
              {file.errors.length} line{file.errors.length === 1 ? "" : "s"} couldn&apos;t be read. The other {file.events.length} loaded.
            </h2>
          </header>
          <ul className="max-h-60 overflow-auto">
            {file.errors.map((e) => (
              <li key={e.line} className="row border-b border-rule px-4 py-2 last:border-b-0">
                <div className="text-[13px] text-ink">
                  <span className="font-semibold">Line {e.line}:</span> {e.message}
                </div>
                <pre className="mt-1 overflow-x-auto whitespace-pre font-mono text-[12px] text-ink-2">{e.raw}</pre>
              </li>
            ))}
          </ul>
        </>
      )}
      {file.warnings.length > 0 && (
        <ul className="border-t border-rule px-4 py-2 text-[12px] text-ink-2">
          {file.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
