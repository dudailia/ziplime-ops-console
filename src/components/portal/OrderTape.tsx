"use client";

import { useEffect, useMemo, useRef } from "react";
import { explain, type Profile } from "@/lib/dryrun/explain";
import { cancelledIds, sideOf, whyGroups } from "@/lib/dryrun/metrics";
import { formatMinute } from "@/lib/dryrun/time";
import { EVENT_KINDS, type DryRunEvent, type EventKind, type Session } from "@/lib/dryrun/types";
import { num } from "@/lib/format";
import { Chip, EVENT_TEXT, EVENT_WORD, EventGlyph } from "@/components/ui/kit";
import { WhyPanel } from "./WhyPanel";

export type TapeFilter = { kinds: Set<EventKind>; symbol: string; side: "" | "buy" | "sell"; query: string; group: string | null };

export function emptyFilter(): TapeFilter {
  return { kinds: new Set(EVENT_KINDS), symbol: "", side: "", query: "", group: null };
}

function qty(e: DryRunEvent): string {
  if (e.event === "place") return e.quantity;
  if (e.event === "cancel") return "";
  return num(Math.abs(e.requested_amount));
}

function orderId(e: DryRunEvent): string {
  return e.event === "place" || e.event === "cancel" ? e.dry_run_id : e.ziplime_order_id;
}

function detail(e: DryRunEvent, profile: Profile | null, cancelledAt: Map<string, number>): string {
  switch (e.event) {
    case "place": {
      const at = cancelledAt.get(e.dry_run_id);
      const base = e.broker_validated ? "Validated by Lime" : "Not validated by Lime";
      return at !== undefined ? `${base}. Cancelled at ${formatMinute(at)}` : base;
    }
    case "refuse":
    case "skip":
      return explain(e, profile)?.title ?? "No built-in explanation";
    case "cancel":
      return e.known_order ? "Cancels a dry-run order" : "Not a dry-run order: no broker call in dry run";
  }
}

function RawLine({ e }: { e: DryRunEvent }) {
  let pretty = e.raw;
  try {
    pretty = JSON.stringify(JSON.parse(e.raw), null, 2);
  } catch {}
  return (
    <details className="text-[12px] text-ink-2">
      <summary className="cursor-pointer select-none">Line {e.line} as written</summary>
      <pre className="mt-1 max-h-72 overflow-auto bg-sunk px-2 py-1.5 font-mono text-[12px] leading-snug text-ink">{pretty}</pre>
    </details>
  );
}

const GRID = "md:grid md:grid-cols-[52px_104px_64px_44px_56px_92px_minmax(0,1fr)] md:items-center md:gap-x-3";

export function OrderTape({
  session,
  profile,
  selected,
  onSelect,
  filter,
  setFilter,
}: {
  session: Session;
  profile: Profile | null;
  selected: number | null;
  onSelect: (line: number | null) => void;
  filter: TapeFilter;
  setFilter: (f: TapeFilter) => void;
}) {
  const symbols = useMemo(() => [...new Set(session.events.map((e) => e.symbol).filter(Boolean) as string[])].sort(), [session]);
  const cancelled = useMemo(() => cancelledIds(session.events), [session]);
  const cancelledAt = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of session.events) if (e.event === "cancel" && e.known_order) m.set(e.dry_run_id, e.clock.minuteET);
    return m;
  }, [session]);
  const groupLines = useMemo(() => {
    if (!filter.group) return null;
    const g = whyGroups(session.events, profile).find((x) => x.key === filter.group);
    return new Set(g?.events.map((e) => e.line) ?? []);
  }, [filter.group, session, profile]);

  const rows = session.events.filter((e) => {
    if (!filter.kinds.has(e.event)) return false;
    if (filter.symbol && e.symbol !== filter.symbol) return false;
    if (filter.side && sideOf(e) !== filter.side) return false;
    if (groupLines && !groupLines.has(e.line)) return false;
    if (filter.query) {
      const q = filter.query.trim().toLowerCase();
      const hay = [orderId(e), e.symbol ?? "", e.event === "place" ? e.ziplime_order_id : "", String(e.line)].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected === null) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-line="${selected}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  const toggleKind = (k: EventKind) => {
    const kinds = new Set(filter.kinds);
    if (kinds.has(k) && kinds.size > 1) kinds.delete(k);
    else kinds.add(k);
    setFilter({ ...filter, kinds });
  };

  const selectedHidden = selected !== null && !rows.some((e) => e.line === selected);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2.5">
        {EVENT_KINDS.map((k) => (
          <Chip key={k} active={filter.kinds.has(k)} onClick={() => toggleKind(k)}>
            <EventGlyph kind={k} size={11} />
            {EVENT_WORD[k]}
            <span className="tabular-nums opacity-75">{session.counts[k]}</span>
          </Chip>
        ))}
        <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
          <select
            aria-label="Symbol"
            value={filter.symbol}
            onChange={(ev) => setFilter({ ...filter, symbol: ev.target.value })}
            className="rounded-[4px] border border-rule bg-surface px-2 py-1 text-[13px] text-ink"
          >
            <option value="">All symbols</option>
            {symbols.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            aria-label="Side"
            value={filter.side}
            onChange={(ev) => setFilter({ ...filter, side: ev.target.value as TapeFilter["side"] })}
            className="rounded-[4px] border border-rule bg-surface px-2 py-1 text-[13px] text-ink"
          >
            <option value="">Buys and sells</option>
            <option value="buy">Buys</option>
            <option value="sell">Sells</option>
          </select>
          <input
            type="search"
            aria-label="Search by order id, symbol or line"
            placeholder="Order id or line"
            value={filter.query}
            onChange={(ev) => setFilter({ ...filter, query: ev.target.value })}
            className="min-w-0 flex-1 rounded-[4px] border border-rule bg-surface px-2 py-1 text-[13px] text-ink placeholder:text-ink-3 sm:w-40 sm:flex-none"
          />
        </div>
        {filter.group && (
          <p className="w-full text-[12px] text-ink-2">
            Showing one reason only.{" "}
            <button type="button" className="underline" onClick={() => setFilter({ ...filter, group: null })}>
              Show every event
            </button>
          </p>
        )}
      </div>

      <div className={`hidden border-b border-rule px-4 py-1.5 text-[12px] text-ink-3 ${GRID}`}>
        <span>ET</span>
        <span>Event</span>
        <span>Symbol</span>
        <span>Side</span>
        <span className="text-right">Qty</span>
        <span>Type</span>
        <span>Detail</span>
      </div>

      <div ref={listRef} role="list" className="max-h-[560px] overflow-y-auto">
        {rows.length === 0 && <p className="px-4 py-6 text-[13px] text-ink-2">No events match these filters.</p>}
        {rows.map((e) => {
          const open = e.line === selected;
          const isCancelled = e.event === "place" && cancelled.has(e.dry_run_id);
          const side = sideOf(e);
          return (
            <div
              key={e.line}
              role="listitem"
              data-line={e.line}
              data-tour={open && e.event === "refuse" ? "refusal" : undefined}
              className={`border-b border-rule last:border-b-0 ${open ? "bg-sunk" : ""}`}
            >
              <button
                type="button"
                aria-expanded={open}
                onClick={() => onSelect(open ? null : e.line)}
                className={`w-full px-4 py-1.5 text-left text-[13px] hover:bg-sunk ${GRID} flex flex-wrap items-center gap-x-3 gap-y-0.5`}
              >
                <span className="t-cond tabular-nums text-ink-2">{formatMinute(e.clock.minuteET)}</span>
                <span className={`t-cond inline-flex items-center gap-1.5 font-semibold ${EVENT_TEXT[e.event]}`}>
                  <EventGlyph kind={e.event} size={11} />
                  {EVENT_WORD[e.event]}
                </span>
                <span className="t-cond font-semibold text-ink">{e.symbol ?? "?"}</span>
                <span className="t-cond text-ink-2">{side ?? ""}</span>
                <span className={`t-cond tabular-nums text-ink md:text-right ${isCancelled ? "strike text-cancel" : ""}`}>{qty(e)}</span>
                <span className="t-cond text-ink-2">
                  {e.event === "place" ? `${e.order_type}${e.limit_price ? ` ${e.limit_price}` : ""}` : ""}
                </span>
                <span className="t-cond w-full truncate text-ink-2 md:w-auto">{detail(e, profile, cancelledAt)}</span>
              </button>
              {open && (
                <div className="flex flex-col gap-3 px-4 pb-4 pt-1 md:pl-[76px]">
                  {(e.event === "refuse" || e.event === "skip") && <WhyPanel event={e} profile={profile} />}
                  {e.event === "place" && (
                    <p className="max-w-[72ch] text-[13px] text-ink">
                      This order passed every check and was written to the file instead of being sent. Dry-run orders never fill.
                      {!e.broker_validated && " The run had validate_orders=False, so Lime was never asked."}
                    </p>
                  )}
                  {e.event === "cancel" && (
                    <p className="max-w-[72ch] text-[13px] text-ink">
                      {e.known_order
                        ? "The strategy cancelled a dry-run order. In dry run the cancel is recorded and never reaches the broker."
                        : "The strategy cancelled an id this dry run didn't place. In dry run the engine never calls the broker, so nothing was cancelled at Lime."}
                    </p>
                  )}
                  <div className="font-mono text-[12px] text-ink-2">
                    {e.event === "place" || e.event === "cancel" ? e.dry_run_id : `ziplime ${e.ziplime_order_id}`}
                  </div>
                  <RawLine e={e} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 border-t border-rule px-4 py-2 text-[12px] text-ink-3">
        <span>
          {rows.length} of {session.events.length} events
        </span>
        {selectedHidden && (
          <button type="button" className="underline" onClick={() => setFilter(emptyFilter())}>
            The selected event is filtered out. Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
