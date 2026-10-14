// The Postgres adapter (PLAN.md 15.4). Page reads run as role authenticated
// with ops claims, so row-level security applies to the app too. Writes go
// through the owner connection, inside one transaction each.

import { asClaims, OPS, type Db, type Sql } from "../db/db";
import type { Ticket } from "../inbox";
import { handleIngest } from "../ingest/http";
import type { IngestResponse } from "../ingest/types";
import type { Signup } from "../intake/types";
import type { PlanKey } from "../plans";
import type { Account, Deployment, RiskEnv } from "../seed";
import type { DataSource } from "./source";
import { STATIC_DATASET } from "./static";
import type { Dataset, IngestBatchView, SignupDecision } from "./types";

/** Batches per deployment on the account page. */
export const RECENT_BATCHES = 20;

const ET_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** A timestamp as the seed writes them: ET wall time with its offset, "2026-10-12T16:20:00-04:00". */
export function toEtIso(at: Date | string): string {
  const d = at instanceof Date ? at : new Date(at);
  const p = Object.fromEntries(ET_PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offset = Math.round((wall - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${hh}:${mm}`;
}

type AccountRow = { id: string; trader: string; company: string | null; email: string; account_number: string; plan: PlanKey; joined: string; from_intake: string | null };
type DeploymentRow = {
  id: string;
  account_id: string;
  strategy: string;
  description: string;
  symbols: string[];
  risk_env: RiskEnv | null;
  validate_orders: boolean;
  deadlines: Record<string, string>;
  next_line: number;
  sessions: string[];
  file: string | null;
};
type TicketRow = { id: string; account_id: string; subject: string; created_at: Date; messages: Ticket["messages"]; links: Ticket["links"]; draft: Ticket["draft"] | null; rule: Ticket["rule"] | null };
type SignupRow = {
  id: string;
  email: string;
  ts: Date;
  page: string;
  trade: string[];
  style: string[];
  funded: string[];
  pain: string[];
  wants_pod: boolean;
  note: string | null;
  decision: "approved" | "dismissed" | null;
  decided_by: string | null;
  decided_at: Date | null;
  account_id: string | null;
};
type BatchRow = {
  id: string;
  deployment_id: string;
  received_at: Date;
  status: IngestBatchView["status"];
  file: string | null;
  first_line: number | null;
  line_count: number;
  accepted: number;
  duplicate: number;
  rejected: number;
  ignored: number;
  result: Partial<IngestResponse> | null;
};

export async function readDataset(sql: Sql): Promise<Dataset> {
  const accounts = (
    await sql.query<AccountRow>(
      `select a.id, a.trader, a.company, a.email, a.account_number, a.plan, a.joined::text as joined, s.id as from_intake
       from public.accounts a left join public.signups s on s.account_id = a.id order by a.created_seq`,
    )
  ).map((r): Account => ({
    id: r.id,
    trader: r.trader,
    company: r.company,
    email: r.email,
    accountNumber: r.account_number,
    plan: r.plan,
    joined: r.joined,
    ...(r.from_intake ? { fromIntake: r.from_intake } : {}),
  }));

  const deployments = (
    await sql.query<DeploymentRow>(
      `select d.id, d.account_id, d.strategy, d.description, d.symbols, d.risk_env, d.validate_orders, d.deadlines, d.next_line,
         coalesce((select array_agg(s.date::text order by s.date) from public.sessions s where s.deployment_id = d.id), '{}') as sessions,
         (select b.file from public.ingest_batches b where b.deployment_id = d.id and b.status = 'stored'
            order by b.received_at desc, b.first_line desc limit 1) as file
       from public.deployments d order by d.created_seq`,
    )
  ).map(
    (r): Deployment => ({
      id: r.id,
      account: r.account_id,
      strategy: r.strategy,
      description: r.description,
      file: r.file ?? `${r.id}.jsonl`,
      symbols: r.symbols,
      riskEnv: r.risk_env,
      validateOrders: r.validate_orders,
      deadlines: r.deadlines,
      sessions: r.sessions,
      lines: Number(r.next_line) - 1,
    }),
  );

  // Each file rebuilt from its stored lines: line N on line N, empty where nothing was stored.
  const lines = await sql.query<{ deployment_id: string; line_no: number; raw_line: string }>(
    "select deployment_id, line_no, raw_line from public.dry_run_events order by deployment_id, line_no",
  );
  const byDeployment = new Map<string, { line_no: number; raw_line: string }[]>();
  for (const l of lines) {
    const list = byDeployment.get(l.deployment_id) ?? [];
    list.push(l);
    byDeployment.set(l.deployment_id, list);
  }
  const files: Record<string, string> = {};
  for (const d of deployments) {
    const list = byDeployment.get(d.id) ?? [];
    if (list.length === 0) {
      files[d.id] = "";
      continue;
    }
    const text = new Array<string>(Number(list[list.length - 1].line_no)).fill("");
    for (const l of list) text[Number(l.line_no) - 1] = l.raw_line;
    files[d.id] = text.join("\n") + "\n";
  }

  const tickets = (
    await sql.query<TicketRow>("select id, account_id, subject, created_at, messages, links, draft, rule from public.tickets order by id")
  ).map(
    (r): Ticket => ({
      id: r.id,
      accountId: r.account_id,
      subject: r.subject,
      createdAt: toEtIso(r.created_at),
      messages: r.messages,
      links: r.links,
      ...(r.draft ? { draft: r.draft } : {}),
      ...(r.rule ? { rule: r.rule } : {}),
    }),
  );

  const decisions: Record<string, SignupDecision> = {};
  const signups = (
    await sql.query<SignupRow>(
      "select id, email, ts, page, trade, style, funded, pain, wants_pod, note, decision, decided_by, decided_at, account_id from public.signups order by id",
    )
  ).map((r): Signup => {
    if (r.decision && r.decided_by && r.decided_at) {
      decisions[r.id] = { kind: r.decision, by: r.decided_by, at: r.decided_at.toISOString(), ...(r.account_id ? { accountId: r.account_id } : {}) };
    }
    return {
      id: r.id,
      email: r.email,
      ts: toEtIso(r.ts),
      page: r.page,
      trade: r.trade,
      style: r.style,
      funded: r.funded,
      pain: r.pain,
      wantsPod: r.wants_pod,
      ...(r.note !== null ? { note: r.note } : {}),
    };
  });

  const ingest: Record<string, IngestBatchView[]> = {};
  const batches = await sql.query<BatchRow>(
    `select id, deployment_id, received_at, status, file, first_line, line_count, accepted, duplicate, rejected, ignored, result
     from (select b.*, row_number() over (partition by deployment_id order by received_at desc, id) as n from public.ingest_batches b) x
     where n <= ${RECENT_BATCHES} order by deployment_id, received_at desc, id`,
  );
  for (const b of batches) {
    const rejectedLines =
      b.status === "stored"
        ? (b.result?.results ?? []).filter((r) => r.status === "rejected").map((r) => ({ line: r.line, reason: r.reason ?? "" }))
        : [];
    (ingest[b.deployment_id] ??= []).push({
      id: b.id,
      receivedAt: b.received_at.toISOString(),
      status: b.status,
      file: b.file,
      firstLine: b.first_line,
      lineCount: b.line_count,
      accepted: b.accepted,
      duplicate: b.duplicate,
      rejected: b.rejected,
      ignored: b.ignored,
      rejectedLines,
    });
  }

  return {
    source: "postgres",
    // The seed's calendar and engine commit: the database holds trading data, not the demo's frame of reference.
    calendar: STATIC_DATASET.calendar,
    ziplime: STATIC_DATASET.ziplime,
    accounts,
    deployments,
    files,
    tickets,
    signups,
    decisions,
    ingest,
  };
}

export function postgresSource(db: Db): DataSource {
  return {
    kind: "postgres",
    load: () => asClaims(db, OPS, readDataset),
    ingest: (deploymentId, body, headers, now) => handleIngest(db, deploymentId, body, headers, now),
    approveSignup: async () => {
      throw new Error("approveSignup is built in part 5");
    },
    rotateKey: async () => {
      throw new Error("rotateKey is built in part 5");
    },
  };
}
