"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { CALENDAR, summarizeAccount, type DeploymentSummary } from "@/lib/crm";
import { groupSessions } from "@/lib/dryrun/parse";
import { sessionLabel, stampET } from "@/lib/format";
import { HEALTH_LABEL } from "@/lib/health";
import { PLANS, PLANS_SOURCE, planByKey } from "@/lib/plans";
import { useStore } from "@/lib/store/StoreProvider";
import { useAccounts } from "@/lib/store/useAccounts";
import { Env, EVENT_TEXT, PageTitle, Panel } from "@/components/ui/kit";
import { HEALTH_TEXT, HealthBadge, HealthDot } from "./HealthBadge";
import { HistoryChart } from "./HistoryChart";
import { AccountTickets } from "./AccountTickets";

type Entry = { at: string; text: ReactNode; by: string; kind: string };

function DeploymentCard({ s }: { s: DeploymentSummary }) {
  const d = s.deployment;
  return (
    <li className="border-b border-rule px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[14px] font-semibold text-ink">{d.strategy}</span>
        <span className="text-[12px] text-ink-2">{d.description}</span>
        <Link href={`/portal?d=${d.id}`} className="ml-auto text-[13px] font-semibold text-ink underline underline-offset-2">
          Open in portal
        </Link>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-[12px] sm:grid-cols-4">
        <div>
          <div className="text-ink-3">Health</div>
          <span className={`inline-flex items-center gap-1.5 font-semibold ${HEALTH_TEXT[s.health.level]}`}>
            <HealthDot level={s.health.level} />
            {HEALTH_LABEL[s.health.level]}
          </span>
        </div>
        <div>
          <div className="text-ink-3">Sessions</div>
          <div className="t-cond text-ink">
            {s.file.sessions.length}, last {s.lastSession ? sessionLabel(s.lastSession) : "none"}
          </div>
        </div>
        <div>
          <div className="text-ink-3">All sessions</div>
          <div className="t-cond tabular-nums">
            <span className={EVENT_TEXT.place}>{s.counts.place} sent</span>, <span className={s.counts.refuse ? EVENT_TEXT.refuse : "text-ink-3"}>{s.counts.refuse} refused</span>
            , <span className={s.counts.skip ? EVENT_TEXT.skip : "text-ink-3"}>{s.counts.skip} skipped</span>
          </div>
        </div>
        <div>
          <div className="text-ink-3">Ready to go live?</div>
          <div className={`t-cond font-semibold ${s.checksPassed === s.checksTotal ? "text-ok" : "text-ink"}`}>
            {s.checksPassed} of {s.checksTotal} checks
          </div>
        </div>
      </div>
      {s.health.level !== "green" && (
        <ul className="mt-2 text-[12px] text-ink-2">
          {s.health.reasons.map((r) => (
            <li key={r.text} className="flex items-center gap-1.5">
              <HealthDot level={r.level} />
              {r.text}
            </li>
          ))}
        </ul>
      )}
      <details className="mt-2 text-[12px] text-ink-2">
        <summary className="cursor-pointer select-none">Risk profile</summary>
        <table className="mt-1.5">
          <tbody>
            {d.riskEnv ? (
              Object.entries(d.riskEnv).map(([k, v]) => (
                <tr key={k}>
                  <td className="pr-4">
                    <Env>{k}</Env>
                  </td>
                  <td>
                    <Env>{v}</Env>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td>No fail-closed profile: no ZIPLIME_* order limits.</td>
              </tr>
            )}
            <tr>
              <td className="pr-4">
                <Env>validate_orders</Env>
              </td>
              <td>
                <Env>{d.validateOrders ? "True" : "False"}</Env>
              </td>
            </tr>
          </tbody>
        </table>
      </details>
    </li>
  );
}

export function AccountDetail() {
  const params = useParams<{ id: string }>();
  const accounts = useAccounts();
  const { state } = useStore();
  const account = accounts.find((a) => a.id === params.id);
  const summary = useMemo(() => (account ? summarizeAccount(account) : null), [account]);
  const [chartDeployment, setChartDeployment] = useState("all");

  if (!account || !summary) {
    return (
      <div>
        <PageTitle title="Account not found" sub="It may have come from a Beta signup approved in another browser, or the demo was reset." />
        <Link href="/ops" className="text-[13px] font-semibold underline">
          Back to accounts
        </Link>
      </div>
    );
  }

  const plan = planByKey(account.plan);
  const chartFiles = summary.deployments.filter((d) => chartDeployment === "all" || d.deployment.id === chartDeployment);
  const points = groupSessions(chartFiles.flatMap((d) => d.file.events)).map((s) => ({ date: s.date, counts: s.counts }));

  const entries: Entry[] = [
    ...state.activity.filter((a) => a.accountId === account.id).map((a) => ({ at: a.at, text: a.text, by: a.by, kind: a.kind })),
    { at: `${account.joined}T09:00:00-04:00`, text: `Joined the ${plan.name} plan`, by: "system", kind: "joined" },
    ...summary.deployments
      .filter((d) => d.file.sessions.length > 0)
      .map((d) => ({
        at: `${d.file.sessions[0].date}T09:30:00-04:00`,
        text: (
          <>
            First dry-run session for <span className="font-semibold">{d.deployment.strategy}</span>
          </>
        ),
        by: "ziplime",
        kind: "session",
      })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return (
    <div>
      <p className="mb-2 text-[12px]">
        <Link href="/ops" className="text-ink-2 underline underline-offset-2 hover:text-ink">
          Accounts
        </Link>
      </p>
      <PageTitle
        title={account.trader}
        sub={
          <>
            {account.company ? `${account.company}. ` : ""}
            <span className="t-cond tabular-nums">{account.accountNumber || "No Lime account yet"}</span>, {account.email}. Joined {sessionLabel(account.joined, true)}.
          </>
        }
      >
        <HealthBadge health={summary.health} reason={false} />
      </PageTitle>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-8">
          <Panel title="Why this colour" aside={`Last 5 sessions per deployment, as of ${sessionLabel(CALENDAR.asOf)}`}>
            <ul className="px-4 py-2.5">
              {summary.health.reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-2 py-0.5 text-[13px]">
                  <span className="mt-1">
                    <HealthDot level={r.level} />
                  </span>
                  <span>
                    {r.text}
                    {r.deployment && summary.deployments.length > 1 && <span className="text-ink-3"> in {r.deployment}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel
            title="Dry-run history"
            aside={
              summary.deployments.length > 1 ? (
                <select
                  aria-label="Deployment"
                  value={chartDeployment}
                  onChange={(e) => setChartDeployment(e.target.value)}
                  className="rounded-sm border border-rule bg-surface px-2 py-0.5 text-[12px] text-ink"
                >
                  <option value="all">All deployments</option>
                  {summary.deployments.map((d) => (
                    <option key={d.deployment.id} value={d.deployment.id}>
                      {d.deployment.strategy}
                    </option>
                  ))}
                </select>
              ) : undefined
            }
          >
            <div className="px-4 py-3">
              {summary.deployments.length === 0 ? (
                <p className="text-[13px] text-ink-2">No dry runs yet. The trader&apos;s first run with dry_run_file set will show up here.</p>
              ) : (
                <HistoryChart points={points} dates={CALENDAR.tradingDays} />
              )}
            </div>
          </Panel>

          <Panel title="Deployments" aside={`${summary.deployments.length}`}>
            {summary.deployments.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-2">None yet.</p>
            ) : (
              <ul>
                {summary.deployments.map((d) => (
                  <DeploymentCard key={d.deployment.id} s={d} />
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
          <AccountTickets accountId={account.id} />

          <Panel title="Plan">
            <div className="px-4 py-3">
              <div className="flex items-baseline gap-2">
                <span className="t-wide text-[20px] font-[750] text-ink">{plan.name}</span>
                <span className="text-[13px] text-ink-2">{plan.priceLabel}</span>
              </div>
              <ul className="mt-1 text-[12px] text-ink-2">
                {plan.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <ul className="mt-3 flex flex-col gap-1 border-t border-rule pt-2 text-[12px]">
                {PLANS.filter((p) => p.locked).map((p) => (
                  <li key={p.key} className="flex justify-between gap-3 text-ink-3">
                    <span>{p.name}</span>
                    <span>{p.status}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-ink-3">
                Plans as shown on limex.com, {stampET(PLANS_SOURCE.checkedAt)}. No prices published for locked tiers.
              </p>
            </div>
          </Panel>

          <Panel title="Activity">
            <ol className="max-h-96 overflow-y-auto">
              {entries.map((e, i) => (
                <li key={i} className="border-b border-rule px-4 py-2 text-[13px] last:border-b-0">
                  <div className="text-ink">{e.text}</div>
                  <div className="text-[11px] text-ink-3">
                    {stampET(e.at)}, {e.by}
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}
