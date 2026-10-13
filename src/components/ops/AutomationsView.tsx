"use client";

import Link from "next/link";
import { useState } from "react";
import { RULES, runRules, type RuleId } from "@/lib/automations";
import { CALENDAR } from "@/lib/crm";
import { sessionLabel, stampET } from "@/lib/format";
import { useStore } from "@/lib/store/StoreProvider";
import { REVIEWER } from "@/lib/store/state";
import { useAccounts } from "@/lib/store/useAccounts";
import { Button, PageTitle, Panel } from "@/components/ui/kit";

function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={`relative h-5 w-9 shrink-0 rounded-full border ${on ? "border-ink bg-ink" : "border-rule-strong bg-sunk"}`}
    >
      <span className={`absolute top-0.5 size-3.5 rounded-full ${on ? "left-[18px] bg-surface" : "left-0.5 bg-ink-3"}`} />
    </button>
  );
}

export function AutomationsView() {
  const { state, dispatch } = useStore();
  const accounts = useAccounts();
  const [justRan, setJustRan] = useState<string | null>(null);
  const name = (id: string) => accounts.find((a) => a.id === id)?.trader ?? id;

  const runNow = () => {
    const at = new Date().toISOString();
    const result = runRules(state, state.rules, at);
    const id = `run-${state.runs.length + 1}-${Date.parse(at)}`;
    dispatch({ type: "rules/run", run: { id, at, by: REVIEWER, lines: result.lines }, tickets: result.tickets, activity: result.activity });
    setJustRan(id);
  };

  const last = state.runs[0];
  const done = last ? last.lines.filter((l) => !l.skipped).length : 0;

  return (
    <div>
      <PageTitle
        title="Automations"
        sub={`Rules run over the dry-run files as of ${sessionLabel(CALENDAR.asOf, true)}. They open tickets and write notes for a person. They never send a reply or switch anything to live.`}
      >
        <Button kind="primary" onClick={runNow} disabled={!Object.values(state.rules).some(Boolean)}>
          Run rules now
        </Button>
      </PageTitle>

      {last && justRan === last.id && (
        <p className="mb-4 overflow-hidden rounded-panel border border-rule bg-surface px-4 py-2.5 text-[13px] text-ink" role="status">
          {done > 0 ? `Run finished: ${done} new effect${done === 1 ? "" : "s"}` : "Run finished: nothing new"}
          {last.lines.length - done > 0 ? `, ${last.lines.length - done} skipped because they already happened` : ""}.{" "}
          {last.lines.some((l) => l.rule === "refusal-streak" && !l.skipped) && (
            <Link href="/ops/inbox" className="font-semibold underline">
              Review the new tickets
            </Link>
          )}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="xl:col-span-5">
          <Panel title="Rules">
            <ul>
              {RULES.map((r) => (
                <li key={r.id} className="flex gap-3 border-b border-rule px-4 py-3 last:border-b-0">
                  <Toggle on={state.rules[r.id]} onChange={() => dispatch({ type: "rules/toggle", rule: r.id as RuleId })} label={r.name} />
                  <div className="min-w-0">
                    <div className={`text-[14px] font-semibold ${state.rules[r.id] ? "text-ink" : "text-ink-3"}`}>{r.name}</div>
                    <dl className="mt-1 grid grid-cols-[44px_1fr] gap-x-2 gap-y-0.5 text-[12px]">
                      <dt className="text-ink-3">When</dt>
                      <dd className="text-ink-2">{r.when}</dd>
                      <dt className="text-ink-3">Then</dt>
                      <dd className="text-ink-2">{r.then}</dd>
                    </dl>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <div className="min-w-0 xl:col-span-7">
          <Panel title="Run log" aside={state.runs.length ? `${state.runs.length} run${state.runs.length === 1 ? "" : "s"}, newest first` : undefined}>
            {state.runs.length === 0 ? (
              <p className="px-4 py-6 text-[13px] text-ink-2">No runs yet. Press Run rules now to see what each rule would do.</p>
            ) : (
              <ol>
                {state.runs.map((run) => (
                  <li key={run.id} className="border-b border-rule last:border-b-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 bg-sunk px-4 py-1.5 text-[12px]">
                      <span className="font-semibold text-ink">{stampET(run.at)}</span>
                      <span className="text-ink-2">by {run.by}</span>
                      <span className="ml-auto text-ink-3">
                        {run.lines.filter((l) => !l.skipped).length} done, {run.lines.filter((l) => l.skipped).length} skipped
                      </span>
                    </div>
                    {run.lines.length === 0 ? (
                      <p className="px-4 py-2 text-[12px] text-ink-3">No rule matched.</p>
                    ) : (
                      <ul>
                        {run.lines.map((l, i) => (
                          <li key={i} className="grid grid-cols-1 gap-x-3 border-t border-rule px-4 py-1.5 text-[12px] sm:grid-cols-[150px_120px_1fr]">
                            <span className="t-cond text-ink-2">{RULES.find((r) => r.id === l.rule)?.name}</span>
                            <Link href={`/ops/accounts/${l.accountId}`} className="t-cond font-semibold text-ink underline-offset-2 hover:underline">
                              {name(l.accountId)}
                            </Link>
                            <span className={l.skipped ? "text-ink-3" : "text-ink"}>{l.text}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
