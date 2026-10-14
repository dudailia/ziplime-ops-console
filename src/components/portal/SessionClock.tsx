"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { cancelledIds, sideOf } from "@/lib/dryrun/metrics";
import { formatMinute, SESSION_CLOSE_MINUTE, SESSION_OPEN_MINUTE } from "@/lib/dryrun/time";
import type { DryRunEvent, Session } from "@/lib/dryrun/types";
import { sessionLabel } from "@/lib/format";
import { EVENT_WORD } from "@/components/ui/kit";

const GUTTER = 64;
const RIGHT = 16;
const TOP = 30;
const LANE = 30;
// Wide enough that the 9:30 and 10:00 labels never touch.
const MIN_WIDTH = 820;
const DRAW_MS = 450;

function describe(e: DryRunEvent): string {
  const time = formatMinute(e.clock.minuteET);
  switch (e.event) {
    case "place":
      return `${time} ${EVENT_WORD.place}: ${e.side} ${e.quantity} ${e.symbol} ${e.order_type}${e.limit_price ? ` at ${e.limit_price}` : ""}`;
    case "refuse":
      return `${time} ${EVENT_WORD.refuse}: ${sideOf(e)} ${Math.abs(e.requested_amount)} ${e.symbol}`;
    case "skip":
      return `${time} ${EVENT_WORD.skip}: ${e.requested_amount} ${e.symbol}, below one lot`;
    case "cancel":
      return `${time} ${EVENT_WORD.cancel}: ${e.symbol ?? "unknown symbol"}${e.known_order ? "" : " (not a dry-run order)"}`;
  }
}

/**
 * The session on the 09:30 to 16:00 ET clock, one lane per symbol. Buys tick
 * up from the lane line, sells tick down. A cancel draws a line from its order
 * to the moment it was cancelled.
 */
export function SessionClock({
  session,
  selected = null,
  onSelect,
  header = true,
  minWidth = MIN_WIDTH,
}: {
  session: Session;
  selected?: number | null;
  /** Without it the clock is a picture: no hover card, no click. */
  onSelect?: (line: number) => void;
  header?: boolean;
  minWidth?: number;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  // Narrow clocks label every other hour, so labels never touch.
  const hourStep = width < 600 ? 120 : 60;
  const [hover, setHover] = useState<{ e: DryRunEvent; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(minWidth, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [minWidth]);

  const lanes = useMemo(() => {
    const symbols = new Set<string>();
    for (const e of session.events) if (e.symbol) symbols.add(e.symbol);
    const list = [...symbols].sort();
    if (session.events.some((e) => !e.symbol)) list.push("?");
    return list;
  }, [session]);

  const cancelled = useMemo(() => cancelledIds(session.events), [session]);
  const placeById = useMemo(() => {
    const m = new Map<string, DryRunEvent>();
    for (const e of session.events) if (e.event === "place") m.set(e.dry_run_id, e);
    return m;
  }, [session]);

  const plotW = width - GUTTER - RIGHT;
  const height = TOP + lanes.length * LANE + 8;
  const span = SESSION_CLOSE_MINUTE - SESSION_OPEN_MINUTE;
  const clampMin = (m: number) => Math.min(SESSION_CLOSE_MINUTE, Math.max(SESSION_OPEN_MINUTE, m));
  const x = (minute: number) => GUTTER + ((clampMin(minute) - SESSION_OPEN_MINUTE) / span) * plotW;
  const laneY = (symbol: string | null) => TOP + lanes.indexOf(symbol ?? "?") * LANE + LANE / 2;
  // Marks draw in time order on mount: a mark's delay is its place in the day.
  const delay = (minute: number) => ({ "--d": `${Math.round(((clampMin(minute) - SESSION_OPEN_MINUTE) / span) * DRAW_MS)}ms` }) as CSSProperties;
  const outside = session.events.filter((e) => e.clock.minuteET < SESSION_OPEN_MINUTE || e.clock.minuteET > SESSION_CLOSE_MINUTE);

  const hours = [];
  for (let m = 600; m <= SESSION_CLOSE_MINUTE; m += hourStep) hours.push(m);
  const halves = [];
  for (let m = SESSION_OPEN_MINUTE; m < SESSION_CLOSE_MINUTE; m += 60) halves.push(m);

  const selectedEvent = session.events.find((e) => e.line === selected) ?? null;
  const counts = session.counts;

  return (
    <div className={header ? "overflow-hidden rounded-panel border border-rule bg-surface" : ""}>
      {header && (
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 px-4 pb-1 pt-3">
        <h2 className="t-title text-[24px] text-ink sm:text-[28px]">{sessionLabel(session.date, true)}</h2>
        <p className="font-mono text-[12px] text-ink-2">
          09:30 to 16:00 ET. Buys tick up from the line, sells tick down.
          <span className="sm:hidden"> Scroll sideways for the full day.</span>
        </p>
      </div>
      )}
      <div ref={frame} className="relative overflow-x-auto overscroll-x-contain">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Session clock for ${session.date}: ${counts.place} would send, ${counts.refuse} refused, ${counts.skip} skipped, ${counts.cancel} cancelled. The order tape below lists every event.`}
          className="block select-none"
          onMouseLeave={() => setHover(null)}
        >
          {/* hour grid */}
          {halves.map((m) => (
            <line key={`h${m}`} x1={x(m)} x2={x(m)} y1={TOP - 4} y2={height - 8} stroke="var(--rule)" strokeDasharray="2 3" />
          ))}
          {hours.map((m) => (
            <g key={m}>
              <line x1={x(m)} x2={x(m)} y1={TOP - 6} y2={height - 8} stroke="var(--rule)" />
              <text
                x={x(m)}
                y={TOP - 12}
                textAnchor={m === SESSION_CLOSE_MINUTE ? "end" : "middle"}
                className="fill-ink-2 font-mono text-[11px] font-[500]"
              >
                {m === SESSION_CLOSE_MINUTE ? "16:00" : formatMinute(m).replace(/^0/, "")}
              </text>
            </g>
          ))}
          <line x1={x(SESSION_OPEN_MINUTE)} x2={x(SESSION_OPEN_MINUTE)} y1={TOP - 6} y2={height - 8} stroke="var(--rule-strong)" />
          {hourStep === 60 && (
            <text x={x(SESSION_OPEN_MINUTE)} y={TOP - 12} className="fill-ink-3 font-mono text-[10px] font-[500]">
              9:30
            </text>
          )}

          {/* lanes */}
          {lanes.map((symbol) => (
            <g key={symbol}>
              <line x1={GUTTER} x2={width - RIGHT} y1={laneY(symbol)} y2={laneY(symbol)} stroke="var(--rule-strong)" strokeOpacity={0.55} />
              <text x={GUTTER - 10} y={laneY(symbol) + 4} textAnchor="end" className="fill-ink font-mono text-[12px] font-semibold">
                {symbol}
              </text>
            </g>
          ))}

          {/* selection */}
          {selectedEvent && (
            <line
              x1={x(selectedEvent.clock.minuteET)}
              x2={x(selectedEvent.clock.minuteET)}
              y1={TOP - 4}
              y2={height - 8}
              stroke="var(--ink)"
              strokeWidth={1}
            />
          )}

          {/* cancels first, so the order glyphs sit on top */}
          {session.events.map((e) => {
            if (e.event !== "cancel") return null;
            const place = placeById.get(e.dry_run_id);
            const y = laneY(e.symbol) - 11;
            const x2 = x(e.clock.minuteET);
            const x1 = place ? x(place.clock.minuteET) : x2 - 10;
            return (
              <g key={e.line} className="clock-cancel text-cancel" style={delay(e.clock.minuteET)}>
                <line x1={x1} x2={x2} y1={y} y2={y} stroke="currentColor" strokeWidth={1.5} strokeDasharray={place ? undefined : "2 2"} />
                <line x1={x2} x2={x2} y1={y - 4} y2={y + 4} stroke="currentColor" strokeWidth={1.5} />
              </g>
            );
          })}

          {session.events.map((e) => {
            const cx = x(e.clock.minuteET);
            const cy = laneY(e.symbol);
            const isSel = e.line === selected;
            let glyph;
            if (e.event === "place") {
              const up = e.side === "buy";
              const dim = cancelled.has(e.dry_run_id);
              glyph = (
                <rect
                  x={cx - (isSel ? 2 : 1.5)}
                  y={up ? cy - 11 : cy}
                  width={isSel ? 4 : 3}
                  height={11}
                  fill="var(--place)"
                  opacity={dim ? 0.35 : 1}
                />
              );
            } else if (e.event === "refuse") {
              const r = isSel ? 6 : 5;
              glyph = (
                <path
                  d={`M${cx - r} ${cy - r}L${cx + r} ${cy + r}M${cx + r} ${cy - r}L${cx - r} ${cy + r}`}
                  stroke="var(--refuse)"
                  strokeWidth={isSel ? 2.6 : 2.2}
                />
              );
            } else if (e.event === "skip") {
              glyph = <circle cx={cx} cy={cy} r={isSel ? 5.5 : 4.5} fill="var(--surface)" stroke="var(--skip)" strokeWidth={1.8} />;
            } else {
              glyph = null;
            }
            return (
              <g
                key={`g${e.line}`}
                role="presentation"
                style={delay(e.clock.minuteET)}
                className={onSelect ? "cursor-pointer" : undefined}
                onClick={onSelect ? () => onSelect(e.line) : undefined}
                onMouseEnter={onSelect ? () => setHover({ e, x: cx, y: cy }) : undefined}
              >
                <rect x={cx - 6} y={cy - LANE / 2} width={12} height={LANE} fill="transparent" />
                <g className="clock-mark">{glyph}</g>
              </g>
            );
          })}
        </svg>

        {hover && (
          <div
            className="pointer-events-none absolute z-10 max-w-72 border border-rule-strong bg-surface px-2.5 py-1.5 text-[12px] text-ink"
            style={{
              left: Math.min(hover.x + 10, width - 290),
              top: hover.y + 14,
            }}
          >
            {describe(hover.e)}
            <div className="text-ink-3">Line {hover.e.line}. Click to open it in the tape.</div>
          </div>
        )}
      </div>
      {outside.length > 0 && (
        <p className="border-t border-rule px-4 py-2 text-[12px] text-ink-2">
          {outside.length} event{outside.length === 1 ? "" : "s"} fell outside regular hours and{" "}
          {outside.length === 1 ? "is" : "are"} pinned to the edge of the clock.
        </p>
      )}
    </div>
  );
}
