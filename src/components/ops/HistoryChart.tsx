"use client";

import { useState } from "react";
import { EVENT_KINDS, type EventKind, type Session } from "@/lib/dryrun/types";
import { shortDate } from "@/lib/format";
import { EVENT_WORD, EventGlyph } from "@/components/ui/kit";
import { useWidth } from "@/components/ui/useWidth";

const FILL: Record<EventKind, string> = {
  place: "var(--place)",
  refuse: "var(--refuse)",
  skip: "var(--skip)",
  cancel: "var(--cancel)",
};

// Stacked from the baseline: what went out, then what didn't.
const ORDER: EventKind[] = ["place", "cancel", "skip", "refuse"];

export type HistoryPoint = { date: string; counts: Session["counts"] };

/** Per-session stacked bars. Refusals sit on top so they're read first. */
export function HistoryChart({ points, dates }: { points: HistoryPoint[]; dates: readonly string[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const byDate = new Map(points.map((p) => [p.date, p.counts]));
  const totals = dates.map((d) => {
    const c = byDate.get(d);
    return c ? c.place + c.refuse + c.skip + c.cancel : 0;
  });
  const max = Math.max(4, ...totals);
  const step = max <= 8 ? 2 : max <= 20 ? 5 : 10;
  const top = Math.ceil(max / step) * step;
  const H = 180;
  const L = 28;
  const B = 22;
  const plotH = H - B - 8;
  const slot = (width - L) / dates.length;
  const bar = Math.min(34, slot * 0.62);
  const y = (v: number) => 8 + plotH - (v / top) * plotH;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const hoverCounts = hover ? byDate.get(hover) : null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-2">
        {EVENT_KINDS.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <EventGlyph kind={k} size={10} />
            {EVENT_WORD[k]}
          </span>
        ))}
        <span className="ml-auto text-ink-3">
          {hover && hoverCounts
            ? `${shortDate(hover)}: ${hoverCounts.place} sent, ${hoverCounts.refuse} refused, ${hoverCounts.skip} skipped, ${hoverCounts.cancel} cancelled`
            : "Events per session"}
        </span>
      </div>
      <div ref={ref} className="w-full">
        <svg width={width} height={H} role="img" aria-label="Dry-run events per session, stacked by event" onMouseLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={width} y1={y(v)} y2={y(v)} stroke="var(--rule)" strokeWidth={v === 0 ? 1 : 0.6} />
              <text x={L - 6} y={y(v) + 4} textAnchor="end" className="t-cond fill-ink-3 text-[11px]">
                {v}
              </text>
            </g>
          ))}
          {dates.map((d, i) => {
            const c = byDate.get(d);
            const cx = L + slot * i + slot / 2;
            let acc = 0;
            return (
              <g key={d} onMouseEnter={() => setHover(d)}>
                <rect x={cx - slot / 2} y={0} width={slot} height={H - B} fill="transparent" />
                {c ? (
                  ORDER.map((k) => {
                    const v = c[k];
                    if (!v) return null;
                    const y1 = y(acc + v);
                    const h = y(acc) - y1;
                    acc += v;
                    return <rect key={k} x={cx - bar / 2} y={y1} width={bar} height={Math.max(0, h - 1)} fill={FILL[k]} opacity={hover && hover !== d ? 0.45 : 1} />;
                  })
                ) : (
                  <text x={cx} y={y(0) - 4} textAnchor="middle" className="fill-ink-3 text-[10px]">
                    none
                  </text>
                )}
                {c && c.refuse > 0 && (
                  <text x={cx} y={y(totals[i]) - 4} textAnchor="middle" className="t-cond fill-refuse text-[11px] font-semibold">
                    {c.refuse}
                  </text>
                )}
                <text x={cx} y={H - 6} textAnchor="middle" className="t-cond fill-ink-2 text-[11px]">
                  {slot > 46 ? shortDate(d) : shortDate(d).split(" ")[0]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
