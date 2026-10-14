// Loads the bundled seed into an empty database, in one transaction. Every
// dry-run line goes through the same store the webhook uses, so the seed
// load exercises the ingest path.

import { randomUUID } from "node:crypto";
import type { Db } from "../db/db";
import { sha256Hex } from "../ingest/signature";
import { storeBatch } from "../ingest/store";
import { LIMITS } from "../ingest/types";
import { STATIC_DATASET } from "./static";
import type { Dataset } from "./types";

export async function isEmpty(db: Db): Promise<boolean> {
  const rows = await db.tx((sql) => sql.query<{ n: string }>("select count(*) as n from public.accounts"));
  return Number(rows[0].n) === 0;
}

export async function seedDatabase(db: Db, ds: Dataset = STATIC_DATASET): Promise<void> {
  await db.tx(async (sql) => {
    // One row at a time, in the seed's order; created_seq records it, so reads give the same order back.
    for (const a of ds.accounts) {
      await sql.query(
        `insert into public.accounts (id, trader, company, email, account_number, plan, joined)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [a.id, a.trader, a.company, a.email, a.accountNumber, a.plan, a.joined],
      );
    }
    for (const s of ds.signups) {
      await sql.query(
        `insert into public.signups (id, email, ts, page, trade, style, funded, pain, wants_pod, note)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [s.id, s.email, s.ts, s.page, s.trade, s.style, s.funded, s.pain, s.wantsPod, s.note ?? null],
      );
    }
    for (const d of ds.deployments) {
      await sql.query(
        `insert into public.deployments (id, account_id, strategy, description, symbols, risk_env, validate_orders, deadlines)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [d.id, d.account, d.strategy, d.description, d.symbols, d.riskEnv === null ? null : JSON.stringify(d.riskEnv), d.validateOrders, JSON.stringify(d.deadlines)],
      );
    }
    for (const t of ds.tickets) {
      await sql.query(
        "insert into public.tickets (id, account_id, subject, created_at, messages, links, draft, rule) values ($1, $2, $3, $4, $5, $6, $7, $8)",
        [t.id, t.accountId, t.subject, t.createdAt, JSON.stringify(t.messages), JSON.stringify(t.links), t.draft ? JSON.stringify(t.draft) : null, t.rule ? JSON.stringify(t.rule) : null],
      );
    }
    for (const d of ds.deployments) {
      const text = ds.files[d.id] ?? "";
      const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text ? text.split("\n") : [];
      for (let i = 0; i < lines.length; i += LIMITS.lines) {
        const chunk = lines.slice(i, i + LIMITS.lines);
        const request = { file: d.file, first_line: i + 1, lines: chunk };
        const out = await storeBatch(sql, {
          deploymentId: d.id,
          batchId: randomUUID(),
          bodySha: sha256Hex(JSON.stringify(request)),
          request,
          actor: "seed",
          requestId: null,
        });
        if (out.kind !== "stored" || out.response.accepted !== chunk.length) {
          throw new Error(`Seed file ${d.id} did not load cleanly: ${JSON.stringify(out).slice(0, 300)}`);
        }
      }
    }
    await sql.query("insert into public.audit_log (actor, action, target, detail) values ('seed', 'seed.loaded', 'database', $1)", [
      JSON.stringify({ accounts: ds.accounts.length, deployments: ds.deployments.length, commit: ds.ziplime.commit }),
    ]);
  });
}
