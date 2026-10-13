"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CALENDAR } from "@/lib/crm";
import { sessionLabel } from "@/lib/format";
import { HEALTH_LABEL, healthRank, type HealthLevel } from "@/lib/health";
import { planByKey } from "@/lib/plans";
import { useAccountSummaries } from "@/lib/store/useAccounts";
import { useOpenTicketCounts } from "@/lib/store/selectors";
import { Chip, PageTitle } from "@/components/ui/kit";
import { HEALTH_TEXT, HealthBadge, HealthDot } from "./HealthBadge";

type SortKey = "health" | "trader" | "last" | "deployments" | "tickets";

export function AccountsView() {
  const summaries = useAccountSummaries();
  const tickets = useOpenTicketCounts();
  const [level, setLevel] = useState<HealthLevel | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "health", dir: -1 });

  const counts = useMemo(() => {
    const c: Record<HealthLevel, number> = { red: 0, amber: 0, green: 0, grey: 0 };
    for (const s of summaries) c[s.health.level] += 1;
    return c;
  }, [summaries]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = summaries.filter(
      (s) =>
        (level === "all" || s.health.level === level) &&
        (!q || [s.account.trader, s.account.company ?? "", s.account.accountNumber, s.account.email].join(" ").toLowerCase().includes(q)),
    );
    const value = (s: (typeof list)[number]): number | string => {
      switch (sort.key) {
        case "health":
          return healthRank(s.health.level) * 1000 + s.health.reasons.filter((r) => r.level === s.health.level).length;
        case "trader":
          return s.account.trader;
        case "last":
          return s.lastSession ?? "";
        case "deployments":
          return s.deployments.length;
        case "tickets":
          return tickets[s.account.id] ?? 0;
      }
    };
    return [...list].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return cmp * sort.dir || a.account.trader.localeCompare(b.account.trader);
    });
  }, [summaries, level, query, sort, tickets]);

  const header = (key: SortKey, label: string, className = "") => (
    <th className={`px-3 py-2 font-normal ${className}`} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className={`inline-flex items-center gap-1 hover:text-ink ${sort.key === key ? "font-semibold text-ink" : ""}`}
        onClick={() => setSort(sort.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: key === "trader" ? 1 : -1 })}
      >
        {label}
        {sort.key === key && <span aria-hidden>{sort.dir === 1 ? "↑" : "↓"}</span>}
      </button>
    </th>
  );

  return (
    <div>
      <PageTitle
        title="Accounts"
        sub={`Health from each deployment's last 5 dry-run sessions, as of ${sessionLabel(CALENDAR.asOf, true)}. The worst deployment sets the colour.`}
      />

      <div className="mb-4 grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-4">
        {(["red", "amber", "green", "grey"] as const).map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={level === l}
            onClick={() => setLevel(level === l ? "all" : l)}
            className={`flex flex-col items-start bg-surface px-4 py-3 text-left hover:bg-sunk ${level === l ? "outline-2 -outline-offset-2 outline-ink" : ""}`}
          >
            <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
              <HealthDot level={l} />
              {HEALTH_LABEL[l]}
            </span>
            <span className={`t-wide text-[30px] font-[750] leading-tight tabular-nums ${counts[l] ? HEALTH_TEXT[l] : "text-ink-3"}`}>{counts[l]}</span>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip active={level === "all"} onClick={() => setLevel("all")}>
          All {summaries.length}
        </Chip>
        {level !== "all" && <span className="text-[12px] text-ink-2">Showing {HEALTH_LABEL[level].toLowerCase()} only</span>}
        <input
          type="search"
          aria-label="Search accounts"
          placeholder="Name, company, account number"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="ml-auto w-full rounded-sm border border-rule bg-surface px-2 py-1.5 text-[13px] placeholder:text-ink-3 sm:w-64"
        />
      </div>

      <div className="border border-rule bg-surface">
        <table className="w-full text-[13px]">
          <thead className="hidden border-b border-rule text-left text-[12px] text-ink-3 md:table-header-group">
            <tr>
              {header("trader", "Trader")}
              <th className="px-3 py-2 font-normal">Plan</th>
              {header("deployments", "Deployments", "text-right")}
              {header("last", "Last session")}
              {header("health", "Health")}
              {header("tickets", "Open tickets", "text-right")}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-ink-2">
                  No accounts match. Clear the search or the health filter.
                </td>
              </tr>
            )}
            {rows.map((s) => {
              const open = tickets[s.account.id] ?? 0;
              return (
                <tr key={s.account.id} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-b border-rule px-4 py-3 last:border-b-0 hover:bg-sunk md:table-row md:p-0">
                  <td className="md:px-3 md:py-2.5">
                    <Link href={`/ops/accounts/${s.account.id}`} className="font-semibold text-ink underline-offset-2 hover:underline">
                      {s.account.trader}
                    </Link>
                    <div className="text-[12px] text-ink-2">
                      {s.account.company ? `${s.account.company}, ` : ""}
                      <span className="t-cond tabular-nums">{s.account.accountNumber}</span>
                    </div>
                  </td>
                  <td className="t-cond text-right text-ink-2 md:px-3 md:py-2.5 md:text-left">
                    {planByKey(s.account.plan).name}
                    {s.account.fromIntake && <div className="text-[11px] text-accent">From intake</div>}
                  </td>
                  <td className="t-cond hidden tabular-nums md:table-cell md:px-3 md:py-2.5 md:text-right">{s.deployments.length}</td>
                  <td className="t-cond text-[12px] text-ink-2 md:px-3 md:py-2.5 md:text-[13px] md:text-ink">
                    <span className="md:hidden">
                      {s.deployments.length} deployment{s.deployments.length === 1 ? "" : "s"},{" "}
                    </span>
                    {s.lastSession ? (
                      <>
                        <span className="md:hidden">last </span>
                        {sessionLabel(s.lastSession)}
                      </>
                    ) : (
                      "no sessions"
                    )}
                    {open > 0 && <span className="md:hidden">, {open} open ticket{open === 1 ? "" : "s"}</span>}
                  </td>
                  <td className="col-span-2 md:col-span-1 md:px-3 md:py-2.5">
                    <HealthBadge health={s.health} />
                  </td>
                  <td className="t-cond hidden text-right tabular-nums md:table-cell md:px-3 md:py-2.5">
                    {open > 0 ? (
                      <Link href={`/ops/inbox?account=${s.account.id}`} className="font-semibold text-ink underline">
                        {open}
                      </Link>
                    ) : (
                      <span className="text-ink-3">0</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
