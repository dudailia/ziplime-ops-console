"use client";

import { useState } from "react";
import type { Profile } from "@/lib/dryrun/explain";
import { netShares, readiness, whyGroups, worstEvent } from "@/lib/dryrun/metrics";
import type { ParsedFile, Session } from "@/lib/dryrun/types";
import { pct, plural, shortDate } from "@/lib/format";
import { Env, EVENT_TEXT, EVENT_WORD, EventGlyph, Panel, Stat } from "@/components/ui/kit";

const CELL_TONE = {
  refuse: "border-refuse bg-refuse-soft",
  skip: "border-skip bg-skip-soft",
  cancel: "border-rule-strong bg-sunk",
  place: "border-place bg-place-soft",
} as const;

export function SessionStrip({ sessions, current, onPick }: { sessions: Session[]; current: string; onPick: (date: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <ol className="flex min-w-max gap-1.5" aria-label="Sessions">
        {sessions.map((s) => {
          const worst = worstEvent(s);
          const active = s.date === current;
          return (
            <li key={s.date}>
              <button
                type="button"
                aria-current={active ? "date" : undefined}
                onClick={() => onPick(s.date)}
                className={`flex w-[76px] flex-col items-start border-t-[3px] px-2 py-1.5 text-left ${
                  worst ? CELL_TONE[worst] : "border-rule bg-surface"
                } ${active ? "outline-2 outline-offset-0 outline-ink" : "hover:outline hover:outline-1 hover:outline-rule-strong"}`}
              >
                <span className="t-cond text-[12px] text-ink-2">{shortDate(s.date)}</span>
                <span className="t-wide text-[17px] font-[750] leading-tight tabular-nums text-ink">{s.counts.place}</span>
                <span className="t-cond text-[11px] text-ink-2">
                  {s.counts.refuse > 0 ? <span className="font-semibold text-refuse">{s.counts.refuse} refused</span> : s.counts.skip > 0 ? `${s.counts.skip} skipped` : "clean"}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function EventCounts({ session }: { session: Session }) {
  const c = session.counts;
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4 border border-rule bg-surface px-4 py-3 sm:grid-cols-5">
      {(["place", "refuse", "skip", "cancel"] as const).map((k) => (
        <Stat
          key={k}
          label={
            <span className="inline-flex items-center gap-1.5">
              <EventGlyph kind={k} size={11} />
              {EVENT_WORD[k]}
            </span>
          }
          value={c[k]}
          tone={c[k] > 0 ? EVENT_TEXT[k] : "text-ink-3"}
        />
      ))}
      <Stat label="Refusal rate" value={pct(session.refusalRate)} note="refused of (sent + refused). Skips don't count." />
    </div>
  );
}

export function WhySummary({
  session,
  profile,
  activeGroup,
  onGroup,
}: {
  session: Session;
  profile: Profile | null;
  activeGroup: string | null;
  onGroup: (key: string | null) => void;
}) {
  const groups = whyGroups(session.events, profile);
  return (
    <Panel title="Why didn't these orders go out?" aside={groups.length > 0 ? "Pick one to filter the tape" : undefined}>
      {groups.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-ink-2">Every order this session passed every check. Nothing was refused or skipped.</p>
      ) : (
        <ul>
          {groups.map((g) => {
            const kind = g.kind === "benign" ? "skip" : "refuse";
            const active = activeGroup === g.key;
            return (
              <li key={g.key} className="border-b border-rule last:border-b-0">
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onGroup(active ? null : g.key)}
                  className={`flex w-full items-start gap-3 px-4 py-2 text-left hover:bg-sunk ${active ? "bg-sunk" : ""}`}
                >
                  <span className={`t-wide w-8 shrink-0 text-right text-[18px] font-[750] tabular-nums ${EVENT_TEXT[kind]}`}>{g.events.length}</span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold text-ink">{g.title}</span>
                    <span className="block text-[12px] text-ink-2">
                      {g.kind === "benign"
                        ? "Skipped, not refused. Expected for a rebalancer."
                        : g.kind === "unknown" || !g.explanation?.detailKnown
                          ? "No built-in explanation for the exact message. Open one to read it."
                          : g.explanation?.setting
                            ? <>Setting: <Env>{g.explanation.setting}</Env></>
                            : "A strategy problem, not a setting."}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function NetShares({ session }: { session: Session }) {
  const rows = netShares(session.events);
  return (
    <Panel title="Net shares" aside="If every uncancelled order had filled">
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-ink-2">No orders would have been sent this session.</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-rule text-[12px] text-ink-3">
              <th className="px-4 py-1.5 text-left font-normal">Symbol</th>
              <th className="px-2 py-1.5 text-right font-normal">Bought</th>
              <th className="px-2 py-1.5 text-right font-normal">Sold</th>
              <th className="px-2 py-1.5 text-right font-normal">Cancelled</th>
              <th className="px-4 py-1.5 text-right font-normal">Net</th>
            </tr>
          </thead>
          <tbody className="t-cond tabular-nums">
            {rows.map((r) => (
              <tr key={r.symbol} className="border-b border-rule last:border-b-0">
                <td className="px-4 py-1.5 font-semibold text-ink">{r.symbol}</td>
                <td className="px-2 py-1.5 text-right text-ink">{r.bought || ""}</td>
                <td className="px-2 py-1.5 text-right text-ink">{r.sold || ""}</td>
                <td className="strike px-2 py-1.5 text-right text-cancel">{r.cancelled || ""}</td>
                <td className="px-4 py-1.5 text-right font-semibold text-ink">{r.net > 0 ? `+${r.net}` : r.net}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="border-t border-rule px-4 py-2 text-[12px] text-ink-3">Dry-run orders never fill. This is what would have been sent, not a position.</p>
    </Panel>
  );
}

function Mark({ pass }: { pass: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className={`mt-0.5 shrink-0 ${pass ? "text-ok" : "text-refuse"}`}>
      {pass ? (
        <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" />
      ) : (
        <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2" />
      )}
    </svg>
  );
}

export function Readiness({ file, profile }: { file: ParsedFile; profile: Profile | null }) {
  const [n, setN] = useState(3);
  const checks = readiness(file, profile, n);
  const passed = checks.filter((c) => c.pass).length;
  return (
    <Panel
      title="Ready to go live?"
      aside={
        <span className="inline-flex items-center gap-1.5">
          Last
          <button type="button" aria-label="Fewer sessions" className="size-6 rounded-sm border border-rule leading-none hover:border-ink" onClick={() => setN(Math.max(1, n - 1))}>
            −
          </button>
          <span className="t-cond w-4 text-center font-semibold tabular-nums text-ink">{n}</span>
          <button type="button" aria-label="More sessions" className="size-6 rounded-sm border border-rule leading-none hover:border-ink" onClick={() => setN(Math.min(10, n + 1))}>
            +
          </button>
          sessions
        </span>
      }
    >
      <div className="border-b border-rule px-4 py-2.5">
        <span className={`t-wide text-[20px] font-[750] ${passed === checks.length ? "text-ok" : "text-ink"}`}>
          {passed} of {checks.length}
        </span>{" "}
        <span className="text-[13px] text-ink-2">
          {passed === checks.length ? "checks pass. A person at Limex still reviews before anything goes live." : "checks pass. Not ready yet."}
        </span>
      </div>
      <ul>
        {checks.map((c) => (
          <li key={c.id} className="flex gap-2.5 border-b border-rule px-4 py-2 last:border-b-0">
            <Mark pass={c.pass} />
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-ink">{c.label}</div>
              <div className="break-words text-[12px] text-ink-2">{c.evidence}</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="border-t border-rule px-4 py-2 text-[12px] text-ink-3">Over the whole file, {plural(file.sessions.length, "session")}. Checks 2 and 4 use the last {n}.</p>
    </Panel>
  );
}
