"use client";

import { CATEGORY_LABEL, segments, type GuardHit } from "@/lib/guard";

/** A draft with the guard's hits listed and highlighted. Edits re-run the guard upstream. */
export function DraftEditor({
  subject,
  body,
  onChange,
  hits,
  subjectHits = [],
  readOnly = false,
  label = "Draft",
}: {
  subject?: string;
  body: string;
  onChange: (next: { subject?: string; body: string }) => void;
  hits: GuardHit[];
  subjectHits?: GuardHit[];
  readOnly?: boolean;
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {subject !== undefined && (
        <label className="flex flex-col gap-1 text-[12px] text-ink-2">
          Subject
          <input
            value={subject}
            readOnly={readOnly}
            onChange={(e) => onChange({ subject: e.target.value, body })}
            className="rounded-[4px] border border-rule bg-surface px-2 py-1.5 text-[13px] text-ink read-only:bg-sunk"
          />
        </label>
      )}
      <label className="flex flex-col gap-1 text-[12px] text-ink-2">
        {label}
        <textarea
          value={body}
          readOnly={readOnly}
          onChange={(e) => onChange({ subject, body: e.target.value })}
          rows={Math.min(24, Math.max(6, body.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 78)), 1)))}
          className="min-h-32 rounded-[4px] border border-rule bg-surface px-2.5 py-2 text-[13px] leading-relaxed text-ink [field-sizing:content] read-only:bg-sunk"
        />
      </label>
      {subjectHits.length > 0 && (
        <p className="text-[12px] text-refuse">
          Subject: {subjectHits.map((h) => `${CATEGORY_LABEL[h.category]} ("${h.match}")`).join(", ")}
        </p>
      )}
      <GuardReport text={body} hits={hits} blocked={subjectHits.length > 0} />
    </div>
  );
}

export function GuardReport({ text, hits, blocked = false }: { text: string; hits: GuardHit[]; blocked?: boolean }) {
  if (hits.length === 0 && blocked) return <p className="text-[12px] font-semibold text-refuse">Guard blocked approval. Fix the subject line.</p>;
  if (hits.length === 0) {
    return (
      <p className="text-[12px] text-ink-2">
        <span className="font-semibold text-ok">Guard: nothing found.</span> It checks phrases for promised returns, investment advice and other
        clients. It is not a compliance review, so read every word before you approve.
      </p>
    );
  }
  const counts = new Map<string, number>();
  for (const h of hits) counts.set(CATEGORY_LABEL[h.category], (counts.get(CATEGORY_LABEL[h.category]) ?? 0) + 1);
  return (
    <div className="overflow-hidden rounded-panel border border-refuse bg-surface" role="status" data-tour="guard">
      <div className="border-b border-rule px-3 py-2 text-[13px]">
        <span className="font-semibold text-refuse">Guard blocked approval.</span>{" "}
        <span className="text-ink-2">
          {[...counts].map(([k, n]) => `${k}${n > 1 ? ` (${n})` : ""}`).join(", ")}. Edit the highlighted text to continue.
        </span>
      </div>
      <p className="whitespace-pre-wrap px-3 py-2 text-[13px] leading-relaxed text-ink">
        {segments(text, hits).map((s, i) =>
          s.hit ? (
            <mark key={i} className="guard-hit" title={CATEGORY_LABEL[s.hit.category]}>
              {s.text}
            </mark>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </p>
    </div>
  );
}
