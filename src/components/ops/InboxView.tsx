"use client";

import { DefaultView, NO_PARAMS } from "@/components/ui/DefaultView";
import { WithFiles } from "@/lib/data/WithFiles";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useAiStatus } from "@/lib/ai/useAiStatus";
import { summarizeAccount } from "@/lib/crm";
import { explain } from "@/lib/dryrun/explain";
import { sideOf } from "@/lib/dryrun/metrics";
import { formatMinute } from "@/lib/dryrun/time";
import { shortDate, stampET } from "@/lib/format";
import { useDataset } from "@/lib/data/DatasetProvider";
import { linkedEvents, templateReply, type Message, type Ticket } from "@/lib/inbox";
import { ticketStatus, TICKET_STATUS_LABEL, type TicketStatus } from "@/lib/inbox/status";
import { useStore } from "@/lib/store/StoreProvider";
import { currentReply, REVIEWER, replyHits, thread } from "@/lib/store/state";
import { useAccounts } from "@/lib/store/useAccounts";
import { useTickets } from "@/lib/store/selectors";
import { AiOffNote, Button, Check, Chip, EVENT_TEXT, EVENT_WORD, EventGlyph, PageTitle, Panel } from "@/components/ui/kit";
import { DraftEditor } from "@/components/ui/DraftEditor";
import { WhyPanel } from "@/components/portal/WhyPanel";
import { useFresh } from "@/components/ui/useFresh";
import { HealthBadge } from "./HealthBadge";

const STATUS_TONE: Record<TicketStatus, string> = {
  "needs-reply": "font-semibold text-ink",
  "in-review": "font-semibold text-ink-2",
  flagged: "font-semibold text-refuse",
  replied: "text-ink-3",
};

/** One message. A reply approved a moment ago flashes once, so the send is unmistakable. */
function ThreadMessage({ m }: { m: Message }) {
  const fresh = useFresh(m.approvedBy ? m.at : undefined);
  return (
    <li className={`border-b border-rule px-4 py-3 last:border-b-0 ${m.from === "limex" ? "bg-sunk" : ""} ${fresh ? "approve-flash" : ""}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
        <span className="font-semibold text-ink">{m.author}</span>
        <span className="text-ink-3">{stampET(m.at)}</span>
        {m.approvedBy && (
          <span className="inline-flex items-center gap-1 font-semibold text-ok">
            <Check />
            Approved by {m.approvedBy}, marked as sent
          </span>
        )}
      </div>
      <p className="mt-1 max-w-[72ch] whitespace-pre-wrap text-[13px] text-ink">{m.body}</p>
    </li>
  );
}

function LinkedLines({ ticket }: { ticket: Ticket }) {
  const [open, setOpen] = useState<string | null>(null);
  const ds = useDataset();
  const linked = linkedEvents(ds, ticket);
  if (linked.length === 0) return null;
  return (
    <Panel title="Linked dry-run lines" aside="From this account's own files">
      {linked.map(({ deployment, profile, events }) => (
        <div key={deployment.id}>
          <div className="flex flex-wrap items-baseline gap-2 border-b border-rule bg-sunk px-4 py-1.5 text-[12px] text-ink-2">
            <span className="font-semibold text-ink">{deployment.strategy}</span>
            <Link className="ml-auto underline" href={`/portal?d=${deployment.id}`}>
              Open in portal
            </Link>
          </div>
          <ul>
            {events.map((e) => {
              const key = `${deployment.id}:${e.line}`;
              const x = e.event === "refuse" || e.event === "skip" ? explain(e, profile) : null;
              const isOpen = open === key;
              return (
                <li key={key} className="row border-b border-rule last:border-b-0">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : key)}
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-1.5 text-left text-[13px] hover:bg-sunk"
                  >
                    <span className="t-cond tabular-nums text-ink-2">
                      {shortDate(e.clock.session)} {formatMinute(e.clock.minuteET)}
                    </span>
                    <span className={`t-cond inline-flex items-center gap-1.5 font-semibold ${EVENT_TEXT[e.event]}`}>
                      <EventGlyph kind={e.event} size={11} />
                      {EVENT_WORD[e.event]}
                    </span>
                    <span className="t-cond font-semibold">
                      {sideOf(e) ?? ""} {e.symbol}
                    </span>
                    <span className="t-cond min-w-0 flex-1 truncate text-ink-2">
                      {x ? x.title : e.event === "refuse" || e.event === "skip" ? "No built-in explanation" : e.event === "place" ? (e.broker_validated ? "Validated by Lime" : "Not validated by Lime") : ""}
                    </span>
                  </button>
                  {isOpen && (e.event === "refuse" || e.event === "skip") && (
                    <div className="px-4 pb-3 pt-1">
                      <WhyPanel event={e} profile={profile} />
                    </div>
                  )}
                  {isOpen && e.event === "place" && (
                    <pre className="mx-4 mb-3 overflow-x-auto bg-sunk px-2 py-1.5 font-mono text-[12px] text-ink">{e.raw}</pre>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </Panel>
  );
}

function Composer({ ticket }: { ticket: Ticket }) {
  const { state, dispatch } = useStore();
  const ds = useDataset();
  const accounts = useAccounts();
  const ai = useAiStatus();
  const account = accounts.find((a) => a.id === ticket.accountId)!;
  const reply = currentReply(state, ticket);
  const text = reply?.text ?? "";
  const hits = replyHits(ds, state, ticket, text);
  const status = ticketStatus(ds, state, ticket);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = () => new Date().toISOString();

  const set = (next: string, source: "template" | "claude" | "human") =>
    dispatch({ type: "reply/set", ticketId: ticket.id, text: next, source, by: REVIEWER, at: now() });

  const draftWithClaude = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket: { accountId: ticket.accountId, subject: ticket.subject, messages: thread(state, ticket), links: ticket.links } }),
      });
      const body = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || !body.text) throw new Error(body.error ?? `Request failed (${res.status})`);
      set(body.text, "claude");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  const sourceNote =
    reply?.source === "claude"
      ? "Drafted by Claude from this account's data only"
      : reply?.source === "template"
        ? "Template reply built from the file"
        : reply
          ? `Draft by ${reply.by}`
          : null;

  return (
    <Panel title="Reply" aside={<span className={STATUS_TONE[status]}>{TICKET_STATUS_LABEL[status]}</span>}>
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2.5">
        {ai?.enabled && (
          <Button onClick={draftWithClaude} disabled={busy}>
            {busy ? "Drafting…" : "Draft with Claude"}
          </Button>
        )}
        <Button kind={ai?.enabled ? "quiet" : "secondary"} onClick={() => set(templateReply(ds, ticket, account), "template")}>
          Insert template reply
        </Button>
        {reply && (
          <Button kind="quiet" onClick={() => dispatch({ type: "reply/discard", ticketId: ticket.id })}>
            Discard draft
          </Button>
        )}
        {ai && !ai.enabled && (
          <div className="w-full">
            <AiOffNote>The template reply uses the same facts Claude would get, and goes through the same review.</AiOffNote>
          </div>
        )}
        {error && <p className="w-full text-[12px] text-refuse">{error}</p>}
      </div>
      <div className="px-4 py-3">
        {sourceNote && <p className="mb-2 text-[12px] text-ink-3">{sourceNote}. Editing sends it back to review.</p>}
        <DraftEditor body={text} hits={hits} label="Message to the trader" onChange={(next) => set(next.body, "human")} />
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-rule px-4 py-3">
        <Button
          kind="primary"
          disabled={status !== "in-review"}
          title={status === "flagged" ? "The guard flagged the draft. Edit it first." : status !== "in-review" ? "Write or insert a draft first." : undefined}
          onClick={() => dispatch({ type: "reply/approve", ticketId: ticket.id, by: REVIEWER, at: now() })}
        >
          Approve and send
        </Button>
        <span className="text-[12px] text-ink-3">Only an approved reply counts as sent. Nothing leaves this demo.</span>
      </div>
    </Panel>
  );
}

function Detail({ ticket }: { ticket: Ticket }) {
  const { state } = useStore();
  const ds = useDataset();
  const accounts = useAccounts();
  const account = accounts.find((a) => a.id === ticket.accountId);
  const summary = useMemo(() => (account ? summarizeAccount(ds, account) : null), [ds, account]);
  const messages = thread(state, ticket);
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-panel border border-rule bg-surface px-4 py-3">
        <div className="text-[12px] text-ink-3">
          {ticket.id}, opened {stampET(ticket.createdAt)}
          {ticket.rule && <span className="text-ink-2">. Opened by automation: {ticket.rule.trigger}</span>}
        </div>
        <h2 className="t-semi mt-0.5 text-[18px] font-semibold text-ink">{ticket.subject}</h2>
        {account && summary && (
          <div className="mt-2 flex flex-wrap items-start gap-x-6 gap-y-2">
            <Link href={`/ops/accounts/${account.id}`} className="text-[13px] font-semibold text-ink underline underline-offset-2">
              {account.trader}
              {account.company ? `, ${account.company}` : ""}
            </Link>
            <HealthBadge health={summary.health} />
          </div>
        )}
      </div>

      <Panel title="Thread">
        <ol>
          {messages.length === 0 && <li className="px-4 py-3 text-[13px] text-ink-2">No messages yet. This ticket was opened by a rule; the first reply starts the thread.</li>}
          {messages.map((m, i) => (
            <ThreadMessage key={i} m={m} />
          ))}
        </ol>
      </Panel>

      <LinkedLines ticket={ticket} />
      <Composer ticket={ticket} />
    </div>
  );
}

type Params = Pick<URLSearchParams, "get" | "toString">;

/** The inbox for the address the browser is on. */
export function InboxFromAddress() {
  return <InboxView params={useSearchParams()} />;
}

/** The inbox with no query: what the server renders (see DefaultView). */
export function InboxDefault() {
  return (
    <DefaultView>
      <InboxView params={NO_PARAMS} />
    </DefaultView>
  );
}

function InboxView({ params }: { params: Params }) {
  const { state } = useStore();
  const ds = useDataset();
  const tickets = useTickets();
  const accounts = useAccounts();
  const router = useRouter();
  const pathname = usePathname();
  const accountFilter = params.get("account");
  const [filter, setFilter] = useState<TicketStatus | "all">("all");

  const rows = useMemo(
    () =>
      tickets
        .filter((t) => !accountFilter || t.accountId === accountFilter)
        .map((t) => ({ t, status: ticketStatus(ds, state, t), account: accounts.find((a) => a.id === t.accountId) }))
        .sort((a, b) => Date.parse(b.t.createdAt) - Date.parse(a.t.createdAt)),
    [ds, tickets, accountFilter, state, accounts],
  );
  const counts = useMemo(() => {
    const c: Record<TicketStatus, number> = { "needs-reply": 0, "in-review": 0, flagged: 0, replied: 0 };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);
  const shown = rows.filter((r) => filter === "all" || r.status === filter);
  const selectedId = params.get("t") ?? shown[0]?.t.id ?? null;
  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  const go = (q: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(q)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const pick = (id: string) => {
    go({ t: id });
    if (window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => document.getElementById("ticket-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };
  const filterAccount = accountFilter ? accounts.find((a) => a.id === accountFilter) : null;

  return (
    <div>
      <PageTitle
        title="Support inbox"
        sub="Every reply is grounded in the account's own dry-run file, checked by the guard, and counts as sent only when a person approves it."
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          All <span className="tabular-nums opacity-75">{rows.length}</span>
        </Chip>
        {(["needs-reply", "flagged", "in-review", "replied"] as const).map((k) => (
          <Chip key={k} active={filter === k} onClick={() => setFilter(k)}>
            {TICKET_STATUS_LABEL[k]} <span className="tabular-nums opacity-75">{counts[k]}</span>
          </Chip>
        ))}
        {filterAccount && (
          <span className="text-[12px] text-ink-2">
            {filterAccount.trader} only.{" "}
            <button type="button" className="underline" onClick={() => go({ account: null, t: null })}>
              Show all accounts
            </button>
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-4">
          <ul className="overflow-hidden rounded-panel border border-rule bg-surface">
            {shown.length === 0 && (
              <li className="px-4 py-6 text-[13px] text-ink-2">
                {filter === "flagged"
                  ? "No draft is flagged. The guard checks every draft as it's written."
                  : filter === "replied"
                    ? "Nothing replied yet. Approve a reply and it lands here."
                    : filter === "in-review"
                      ? "No drafts waiting for review. Insert a template reply on any ticket to start one."
                      : "No tickets match."}{" "}
                {filter !== "all" && (
                  <button type="button" className="font-semibold text-ink underline" onClick={() => setFilter("all")}>
                    Show all tickets
                  </button>
                )}
              </li>
            )}
            {shown.map(({ t, status, account }) => (
              <li key={t.id} className="border-b border-rule last:border-b-0">
                <button
                  type="button"
                  aria-current={t.id === selectedId ? "true" : undefined}
                  data-nav-item
                  onClick={() => pick(t.id)}
                  className={`flex w-full flex-col px-4 py-2.5 text-left hover:bg-sunk ${t.id === selectedId ? "bg-sunk shadow-[inset_3px_0_0_var(--accent-ink)]" : ""}`}
                >
                  <span className="flex items-baseline gap-2 text-[12px]">
                    <span className="t-cond text-ink-3">{t.id}</span>
                    <span className="truncate text-ink-2">{account?.trader}</span>
                    <span className={`t-cond ml-auto shrink-0 ${STATUS_TONE[status]}`}>{TICKET_STATUS_LABEL[status]}</span>
                  </span>
                  <span className="text-[13px] font-semibold text-ink">{t.subject}</span>
                  {t.rule && <span className="text-[11px] text-ink-3">Opened by a rule</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div id="ticket-detail" className="min-w-0 scroll-mt-4 lg:col-span-8">
          {selected ? (
            // The ticket's account summary and linked lines read only that account's files.
            <WithFiles ids={ds.deployments.filter((d) => d.account === selected.accountId).map((d) => d.id)}>
              <Detail key={selected.id} ticket={selected} />
            </WithFiles>
          ) : (
            <p className="text-[13px] text-ink-2">Pick a ticket.</p>
          )}
        </div>
      </div>
    </div>
  );
}
