"use client";

import { DefaultView, NO_PARAMS } from "@/components/ui/DefaultView";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { useAiStatus } from "@/lib/ai/useAiStatus";
import { stampET } from "@/lib/format";
import { useDataset } from "@/lib/data/DatasetProvider";
import type { Onboarded } from "@/lib/data/source";
import { BROKERS, BROKERS_MORE, WORKSPACE_NOTE, workspaceName } from "@/lib/intake/catalog";
import { activeTriage, currentEmail, decisionOf, intakeHits, intakeStatus, STATUS_LABEL, type IntakeStatus } from "@/lib/intake/status";
import { rulesTriage, type Triage } from "@/lib/intake/triage";
import { FORM, POD_TOGGLE, skippedStepTwo, type Signup } from "@/lib/intake/types";
import { useStore } from "@/lib/store/StoreProvider";
import { allAccounts, REVIEWER, type IntakeRecord } from "@/lib/store/state";
import { AiOffNote, Button, Check, Chip, PageTitle, Panel } from "@/components/ui/kit";
import { useFresh } from "@/components/ui/useFresh";
import { DraftEditor } from "@/components/ui/DraftEditor";
import { IngestSetup } from "./IngestSetup";

const PRIORITY_TONE = { high: "text-bad", normal: "text-ink-2", low: "text-ink-3" } as const;

function Answers({ s }: { s: Signup }) {
  return (
    <div className="flex flex-col gap-3">
      {skippedStepTwo(s) && (
        <p className="text-[13px] text-ink-2">Skipped the optional second step. That&apos;s allowed on limex.com, so all we have is the email.</p>
      )}
      {(Object.keys(FORM) as (keyof typeof FORM)[]).map((key) => (
        <div key={key}>
          <div className="text-[12px] text-ink-2">{FORM[key].question}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {FORM[key].options.map((o) => {
              const on = s[key].includes(o);
              return (
                <span
                  key={o}
                  className={`t-cond rounded-[2px] border px-1.5 py-0.5 text-[12px] ${on ? "border-ink bg-ink font-semibold text-surface" : "border-rule text-ink-3"}`}
                >
                  {o}
                </span>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex items-start gap-2 text-[12px]">
        <span
          aria-hidden
          className={`mt-0.5 inline-block h-3.5 w-6 shrink-0 rounded-none border ${s.wantsPod ? "border-ink bg-ink" : "border-rule-strong bg-sunk"}`}
        >
          <span className={`block size-2.5 translate-y-[1px] rounded-none bg-surface ${s.wantsPod ? "translate-x-[11px]" : "translate-x-[1px] bg-ink-3"}`} />
        </span>
        <span className={s.wantsPod ? "font-semibold text-ink" : "text-ink-3"}>{POD_TOGGLE}</span>
      </div>
      <div className="border-l-2 border-dashed border-rule-strong pl-3">
        <div className="text-[12px] text-ink-2">
          Note <span className="text-ink-3">(Proposed field, not on limex.com today)</span>
        </div>
        <p className="mt-0.5 text-[13px] text-ink">{s.note ?? <span className="text-ink-3">None</span>}</p>
      </div>
    </div>
  );
}

function Row({ label, value, rules, why }: { label: string; value: string; rules?: string; why?: string }) {
  const changed = rules !== undefined && rules !== value;
  return (
    <div className="grid grid-cols-[110px_1fr] gap-x-3 border-b border-rule py-2 last:border-b-0">
      <dt className="text-[12px] text-ink-2">{label}</dt>
      <dd className="min-w-0">
        <div className="text-[13px] font-semibold text-ink">
          {value}
          {changed && <span className="ml-2 text-[11px] font-normal text-ink-2">Claude changed this. Rules said: {rules}</span>}
        </div>
        {why && <div className="text-[12px] text-ink-2">{why}</div>}
      </dd>
    </div>
  );
}

const brokerText = (t: Triage) => (t.broker.name ? `${t.broker.name} (${t.broker.tag})` : "Unknown");

function TriageCard({ s, rec }: { s: Signup; rec: IntakeRecord | undefined }) {
  const t = activeTriage(s, rec);
  const rules = rulesTriage(s);
  const showDiff = t.source === "claude";
  return (
    <dl>
      <Row label="Trader type" value={t.traderType} rules={showDiff ? rules.traderType : undefined} why={t.traderTypeWhy} />
      <Row
        label="Assets"
        value={t.assets.length ? t.assets.join(", ") : "None given"}
        rules={showDiff ? (rules.assets.length ? rules.assets.join(", ") : "None given") : undefined}
      />
      <Row label="Likely broker" value={brokerText(t)} rules={showDiff ? brokerText(rules) : undefined} why={t.broker.why} />
      <Row
        label="Workspace"
        value={workspaceName(t.workspace)}
        rules={showDiff ? workspaceName(rules.workspace) : undefined}
        why={`${t.workspaceWhy} ${WORKSPACE_NOTE}`}
      />
      <Row
        label="Priority"
        value={t.priority.level[0].toUpperCase() + t.priority.level.slice(1)}
        why={`${t.priority.reasons.join(". ")}. Set by rules; Claude can't change it.`}
      />
    </dl>
  );
}

/** The approved line. Flashes once when the approval just happened. */
function Approved({ at, children }: { at: string; children: ReactNode }) {
  const fresh = useFresh(at);
  return <p className={`-mx-2 rounded-[2px] px-2 py-1 text-[13px] text-ink ${fresh ? "approve-flash" : ""}`}>{children}</p>;
}

const APPROVE_ERRORS: Record<string, string> = {
  already_decided: "Someone already decided this signup. Showing the current state.",
  guard_flagged: "The server's guard flagged the email. Edit it first.",
  unknown_signup: "This signup isn't in the database.",
  unauthorized: "Sign in again to approve.",
};

function Detail({ s }: { s: Signup }) {
  const { state, dispatch } = useStore();
  const ds = useDataset();
  const router = useRouter();
  const ai = useAiStatus();
  const rec = state.intake[s.id];
  // Database mode: the server creates the account, deployment and key, and returns the key once.
  const [onboarded, setOnboarded] = useState<Onboarded | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const decision =
    decisionOf(ds, state, s.id) ?? (onboarded ? { kind: "approved" as const, by: "you", at: onboarded.account.joined, accountId: onboarded.account.id } : undefined);
  const status = intakeStatus(ds, state, s);
  const email = currentEmail(s, rec);
  const hits = intakeHits(ds, state, s);
  const decided = Boolean(decision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const askClaude = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/triage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: s.id }) });
      const body = (await res.json()) as { triage?: Triage; error?: string };
      if (!res.ok || !body.triage) throw new Error(body.error ?? `Request failed (${res.status})`);
      dispatch({ type: "intake/claude", id: s.id, triage: body.triage });
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  const account = decision?.accountId ? (allAccounts(ds, state).find((a) => a.id === decision.accountId) ?? onboarded?.account) : undefined;

  const approve = async () => {
    const at = new Date().toISOString();
    if (ds.source !== "postgres") {
      dispatch({ type: "intake/approve", id: s.id, by: REVIEWER, at, email });
      return;
    }
    setApproving(true);
    setApproveError(null);
    try {
      const res = await fetch(`/api/ops/signups/${s.id}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(email) });
      const body = (await res.json()) as Onboarded & { error?: string };
      if (!res.ok) {
        setApproveError(APPROVE_ERRORS[body.error ?? ""] ?? `Approval failed (HTTP ${res.status}).`);
        if (res.status === 409) router.refresh();
        return;
      }
      setOnboarded(body);
      router.refresh();
    } catch {
      setApproveError("Couldn't reach the console. Nothing was approved.");
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={<span className="break-all tracking-normal normal-case">{s.email}</span>}
        aside={<span>Signed up {stampET(s.ts)}</span>}
      >
        <div className="px-4 py-3">
          <Answers s={s} />
        </div>
      </Panel>

      <Panel
        tour="triage"
        title="Triage"
        aside={activeTriage(s, rec).source === "claude" ? "Claude's version, checked against the rules" : "Rules version: keyword and answer rules, no AI"}
      >
        <div className="px-4 py-1">
          <TriageCard s={s} rec={rec} />
        </div>
        {!decided && (
          <div className="flex flex-wrap items-center gap-3 border-t border-rule px-4 py-2.5">
            {ai === null ? (
              <span className="text-[12px] text-ink-3">Checking AI…</span>
            ) : ai.enabled ? (
              <>
                <Button onClick={askClaude} disabled={busy}>
                  {busy ? "Triaging with Claude…" : rec?.claude ? "Triage with Claude again" : "Triage with Claude"}
                </Button>
                {rec?.claude && (
                  <Button kind="quiet" onClick={() => dispatch({ type: "intake/use", id: s.id, use: rec.use === "claude" ? "rules" : "claude" })}>
                    {rec.use === "claude" ? "Use the rules version" : "Use Claude's version"}
                  </Button>
                )}
                <span className="text-[12px] text-ink-3">Sends only this signup&apos;s answers.</span>
              </>
            ) : (
              <AiOffNote>The rules version is the whole triage. Approve works the same.</AiOffNote>
            )}
            {error && <p className="w-full text-[12px] text-refuse">{error}</p>}
          </div>
        )}
        <p className="border-t border-rule px-4 py-2 text-[12px] text-ink-3">
          Brokers come from the SnapTrade list on limex.com: {BROKERS.join(", ")}, {BROKERS_MORE}. The form doesn&apos;t ask, so most are unknown.
        </p>
      </Panel>

      <Panel title="Welcome email" aside={decided ? STATUS_LABEL[status] : rec?.draft ? "Edited by you" : "Draft"}>
        <div className="px-4 py-3">
          <DraftEditor
            subject={email.subject}
            body={email.body}
            hits={hits.body}
            subjectHits={hits.subject}
            readOnly={decided}
            label="Body"
            onChange={(next) => dispatch({ type: "intake/edit", id: s.id, subject: next.subject ?? email.subject, body: next.body })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-rule px-4 py-3">
          {decision?.kind === "approved" ? (
            <Approved at={decision.at}>
              <span className="inline-flex items-center gap-1 font-semibold text-ok">
                <Check />
                Approved
              </span>{" "}
              by {decision.by}, {stampET(decision.at)}. Welcome email marked as sent; nothing leaves
              this demo.{" "}
              {account && (
                <Link href={`/ops/accounts/${account.id}`} className="font-semibold underline">
                  Open the new account
                </Link>
              )}
            </Approved>
          ) : decision?.kind === "dismissed" ? (
            <>
              <p className="text-[13px] text-ink-2">
                Dismissed by {decision.by}, {stampET(decision.at)}.
              </p>
              <Button kind="quiet" onClick={() => dispatch({ type: "intake/reopen", id: s.id })}>
                Reopen
              </Button>
            </>
          ) : (
            <>
              <Button
                kind="primary"
                tour="approve-signup"
                disabled={status === "flagged" || approving}
                title={status === "flagged" ? "The guard flagged the email. Edit it first." : undefined}
                onClick={approve}
              >
                {approving ? "Approving…" : "Approve and create account"}
              </Button>
              <Button kind="secondary" onClick={() => dispatch({ type: "intake/dismiss", id: s.id, by: REVIEWER, at: new Date().toISOString() })}>
                Dismiss
              </Button>
              <span className="text-[12px] text-ink-3">
                {ds.source === "postgres"
                  ? "Approving creates the account, its first deployment and an ingest key."
                  : "Approving creates a Beta account in the CRM and marks the email as sent."}
              </span>
              {approveError && <p className="w-full text-[12px] text-refuse">{approveError}</p>}
            </>
          )}
        </div>
        {onboarded && (
          <div className="border-t border-rule px-4 py-3">
            <IngestSetup deploymentId={onboarded.deployment.id} secret={onboarded.secret} profile={onboarded.deployment.riskEnv} />
          </div>
        )}
      </Panel>
    </div>
  );
}

type Params = Pick<URLSearchParams, "get" | "toString">;

/** Intake for the address the browser is on. */
export function IntakeFromAddress() {
  return <IntakeView params={useSearchParams()} />;
}

/** Intake with no query: what the server renders (see DefaultView). */
export function IntakeDefault() {
  return (
    <DefaultView label="Loading signups…">
      <IntakeView params={NO_PARAMS} />
    </DefaultView>
  );
}

function IntakeView({ params }: { params: Params }) {
  const { state } = useStore();
  const ds = useDataset();
  const router = useRouter();
  const pathname = usePathname();
  const [filter, setFilter] = useState<IntakeStatus | "all" | "high">("all");

  const rows = useMemo(
    () =>
      ds.signups.map((s) => ({ s, status: intakeStatus(ds, state, s), t: activeTriage(s, state.intake[s.id]) })).sort(
        (a, b) => Date.parse(b.s.ts) - Date.parse(a.s.ts),
      ),
    [ds, state],
  );
  const counts = useMemo(() => {
    const c: Record<IntakeStatus, number> = { review: 0, flagged: 0, approved: 0, dismissed: 0 };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);
  const shown = rows.filter((r) => (filter === "all" ? true : filter === "high" ? r.t.priority.level === "high" : r.status === filter));
  const selectedId = params.get("id") ?? shown[0]?.s.id ?? null;
  const selected = ds.signups.find((s) => s.id === selectedId) ?? null;
  const pick = (id: string) => {
    router.replace(`${pathname}?id=${id}`, { scroll: false });
    if (window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => document.getElementById("intake-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  return (
    <div>
      <PageTitle
        title="Beta intake"
        sub={
          <>
            limex.com tells signups &ldquo;We read every single answer.&rdquo; This queue helps a person do that faster. Rules triage every signup, Claude can
            refine one, and nothing is approved without a person.
          </>
        }
      />

      <div className="mb-3 flex flex-wrap gap-2">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          All <span className="tabular-nums opacity-75">{rows.length}</span>
        </Chip>
        {(["review", "flagged", "approved", "dismissed"] as const).map((k) => (
          <Chip key={k} active={filter === k} onClick={() => setFilter(k)}>
            {STATUS_LABEL[k]} <span className="tabular-nums opacity-75">{counts[k]}</span>
          </Chip>
        ))}
        <Chip active={filter === "high"} onClick={() => setFilter("high")}>
          High priority <span className="tabular-nums opacity-75">{rows.filter((r) => r.t.priority.level === "high").length}</span>
        </Chip>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-5">
          <div className="overflow-hidden rounded-panel border border-rule bg-surface">
            <ul className="lg:max-h-[calc(100dvh-220px)] lg:overflow-y-auto">
              {shown.length === 0 && (
                <li className="px-4 py-6 text-[13px] text-ink-2">
                  {filter === "approved"
                    ? "No signup approved yet. Approving one creates its Beta account in the CRM."
                    : filter === "flagged"
                      ? "No welcome email is flagged. The guard checks each one as it's edited."
                      : filter === "dismissed"
                        ? "Nothing dismissed."
                        : "No signups match."}{" "}
                  <button type="button" className="font-semibold text-ink underline" onClick={() => setFilter("all")}>
                    Show all signups
                  </button>
                </li>
              )}
              {shown.map(({ s, status, t }) => (
                <li key={s.id} className="border-b border-rule last:border-b-0">
                  <button
                    type="button"
                    aria-current={s.id === selectedId ? "true" : undefined}
                    data-nav-item
                    onClick={() => pick(s.id)}
                    className={`grid w-full grid-cols-[1fr_auto] gap-x-3 px-4 py-2 text-left hover:bg-sunk ${s.id === selectedId ? "bg-sunk shadow-[inset_3px_0_0_var(--accent-ink)]" : ""}`}
                  >
                    <span className="min-w-0 truncate text-[13px] font-semibold text-ink">{s.email}</span>
                    <span className={`t-cond text-[12px] font-semibold capitalize ${PRIORITY_TONE[t.priority.level]}`}>{t.priority.level}</span>
                    <span className="t-cond min-w-0 truncate text-[12px] text-ink-2">
                      {t.traderType}
                      {t.assets.length ? `, ${t.assets.join(", ")}` : ""}
                    </span>
                    <span
                      className={`t-cond text-[12px] ${
                        status === "flagged" ? "font-semibold text-refuse" : status === "approved" ? "text-ok" : status === "dismissed" ? "text-ink-3" : "text-ink-2"
                      }`}
                    >
                      {STATUS_LABEL[status]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div id="intake-detail" className="min-w-0 scroll-mt-4 lg:col-span-7">
          {selected ? <Detail key={selected.id} s={selected} /> : <p className="text-[13px] text-ink-2">Pick a signup.</p>}
        </div>
      </div>
    </div>
  );
}
