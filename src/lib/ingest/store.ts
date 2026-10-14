// Stores one authenticated batch (PLAN.md 15.5). Runs inside the caller's
// transaction and starts by locking the deployment row, so batches for one
// deployment are applied one at a time, in full or not at all.

import type { Sql } from "../db/db";
import type { LineResult } from "../data/types";
import { isParseError, parseDryRun, parseRecord, type Unplaced } from "../dryrun/parse";
import { sha256Hex } from "./signature";
import { LIMITS, type IngestRequest, type IngestResponse } from "./types";

export type StoreInput = {
  deploymentId: string;
  batchId: string;
  bodySha: string;
  request: IngestRequest;
  actor: string;
  requestId: string | null;
};

export type StoreOutcome =
  | { kind: "stored" | "replay"; response: IngestResponse }
  | { kind: "gap"; expectedAtMost: number }
  | { kind: "unknown_deployment" };

type Existing = { line_no: number; content_hash: string; raw_line: string; status: string; session_date: string | null };

type Pending = {
  line: number;
  raw: string;
  hash: string;
  /** Set for a line the parser accepted. */
  record?: Unplaced;
  /** Set for a line that is stored as rejected. */
  reason?: string;
};

const DB_REFUSED = "The database refused a value in this record";

/** The parsed columns of an accepted line. */
function columns(r: Unplaced): unknown[] {
  const get = (k: string) => (k in r ? (r as Record<string, unknown>)[k] : null);
  return [
    r.event,
    r.recorded_at,
    get("order_dt"),
    get("symbol"),
    get("ziplime_order_id"),
    get("dry_run_id"),
    get("client_order_id"),
    get("requested_amount"),
    get("side"),
    get("quantity"),
    get("order_type"),
    get("limit_price"),
    get("reason"),
    get("broker_validated"),
    get("known_order"),
    r.account,
  ];
}

const INSERT_ACCEPTED = `insert into public.dry_run_events (deployment_id, batch_id, line_no, raw_line, content_hash, status,
  event, recorded_at, order_dt, symbol, ziplime_order_id, dry_run_id, client_order_id, requested_amount, side, quantity,
  order_type, limit_price, reason, broker_validated, known_order, account_masked, session_date)
  values ($1, $2, $3, $4, $5, 'accepted', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
  on conflict do nothing returning id`;

const INSERT_REJECTED = `insert into public.dry_run_events (deployment_id, batch_id, line_no, raw_line, content_hash, status, reject_reason)
  values ($1, $2, $3, $4, $5, 'rejected', $6) on conflict do nothing returning id`;

/** Runs one statement under a savepoint, so a refused value fails only that line. */
async function attempt(sql: Sql, text: string, params: unknown[]): Promise<boolean> {
  await sql.query("savepoint line");
  try {
    const rows = await sql.query(text, params);
    await sql.query("release savepoint line");
    return rows.length > 0;
  } catch {
    await sql.query("rollback to savepoint line");
    return false;
  }
}

export async function storeBatch(sql: Sql, input: StoreInput): Promise<StoreOutcome> {
  const { deploymentId: dep, batchId, bodySha, request, actor, requestId } = input;
  const locked = await sql.query<{ next_line: number }>("select next_line from public.deployments where id = $1 for update", [dep]);
  if (locked.length === 0) return { kind: "unknown_deployment" };
  const nextLine = Number(locked[0].next_line);

  // The same body again: return what the first call returned, store nothing.
  const prior = await sql.query<{ id: string; result: IngestResponse }>(
    "select id, result from public.ingest_batches where deployment_id = $1 and body_sha256 = $2 and status = 'stored'",
    [dep, bodySha],
  );
  if (prior.length > 0) {
    const response: IngestResponse = { ...prior[0].result, replay: true };
    await sql.query(
      `insert into public.ingest_batches (id, deployment_id, status, file, body_sha256, first_line, line_count, replay_of, result)
       values ($1, $2, 'replay', $3, $4, $5, $6, $7, $8)`,
      [batchId, dep, request.file, bodySha, request.first_line, request.lines.length, prior[0].id, JSON.stringify(response)],
    );
    await audit(sql, actor, "ingest.replay", dep, { batch_id: batchId, replay_of: prior[0].id }, requestId);
    return { kind: "replay", response };
  }

  if (request.first_line > nextLine) {
    const body = { error: "gap", expected_at_most: nextLine };
    await sql.query(
      `insert into public.ingest_batches (id, deployment_id, status, file, body_sha256, first_line, line_count, result)
       values ($1, $2, 'gap', $3, $4, $5, $6, $7)`,
      [batchId, dep, request.file, bodySha, request.first_line, request.lines.length, JSON.stringify(body)],
    );
    await audit(sql, actor, "ingest.rejected", dep, { batch_id: batchId, error: "gap", expected_at_most: nextLine }, requestId);
    return { kind: "gap", expectedAtMost: nextLine };
  }

  const existing = await sql.query<Existing>(
    "select line_no, content_hash, raw_line, status, session_date::text as session_date from public.dry_run_events where deployment_id = $1",
    [dep],
  );
  const byLine = new Map(existing.map((e) => [Number(e.line_no), e]));
  const byHash = new Map(existing.map((e) => [e.content_hash, Number(e.line_no)]));

  const results: LineResult[] = [];
  const pending: Pending[] = [];
  const inBatch = new Map<string, number>();
  request.lines.forEach((raw, i) => {
    const line = request.first_line + i;
    if (raw.includes("\n")) return results.push({ line, status: "rejected", reason: "A line can't contain a newline" });
    if (raw.trim() === "") return results.push({ line, status: "ignored", reason: "Blank line" });
    const hash = sha256Hex(raw);
    const here = byLine.get(line);
    if (here) {
      return here.content_hash === hash
        ? results.push({ line, status: "duplicate" })
        : results.push({ line, status: "rejected", reason: `Line ${line} already holds a different record` });
    }
    const elsewhere = byHash.get(hash) ?? inBatch.get(hash);
    if (elsewhere !== undefined) return results.push({ line, status: "rejected", reason: `Same record as line ${elsewhere}` });
    inBatch.set(hash, line);
    const bytes = Buffer.byteLength(raw, "utf8");
    if (bytes > LIMITS.lineBytes) {
      pending.push({ line, raw: raw.slice(0, LIMITS.lineBytes), hash, reason: `Longer than 16 KB (${bytes} bytes)` });
      return results.push({ line, status: "rejected", reason: `Longer than 16 KB (${bytes} bytes)` });
    }
    const parsed = parseRecord(raw, line);
    if (isParseError(parsed)) {
      pending.push({ line, raw, hash, reason: parsed.message });
      return results.push({ line, status: "rejected", reason: parsed.message });
    }
    pending.push({ line, raw, hash, record: parsed });
    results.push({ line, status: "accepted" });
  });

  // Session dates come from the whole stream: a cancel belongs to the session of the order it cancels.
  const sessionOf = sessionDates([
    ...existing.filter((e) => e.status === "accepted").map((e) => ({ line: Number(e.line_no), raw: e.raw_line })),
    ...pending.filter((p) => p.record).map((p) => ({ line: p.line, raw: p.raw })),
  ]);

  await sql.query(
    `insert into public.ingest_batches (id, deployment_id, status, file, body_sha256, first_line, line_count, result)
     values ($1, $2, 'stored', $3, $4, $5, $6, '{}')`,
    [batchId, dep, request.file, bodySha, request.first_line, request.lines.length],
  );

  const resultAt = new Map(results.map((r) => [r.line, r]));
  for (const p of pending) {
    const r = resultAt.get(p.line)!;
    if (p.record) {
      const ok = await attempt(sql, INSERT_ACCEPTED, [dep, batchId, p.line, p.raw, p.hash, ...columns(p.record), sessionOf.get(p.line)]);
      if (ok) continue;
      r.status = "rejected";
      r.reason = DB_REFUSED;
      p.reason = DB_REFUSED;
    }
    // A rejected line is kept, so the rebuilt file shows the same error the trader's file does.
    await attempt(sql, INSERT_REJECTED, [dep, batchId, p.line, p.raw, p.hash, p.reason]);
  }

  // An earlier line can move to another session only if a hole before it was filled; keep them right.
  for (const e of existing) {
    const now = sessionOf.get(Number(e.line_no));
    if (e.status === "accepted" && now && now !== e.session_date) {
      await sql.query("update public.dry_run_events set session_date = $3 where deployment_id = $1 and line_no = $2", [dep, e.line_no, now]);
    }
  }

  await sql.query("delete from public.sessions where deployment_id = $1", [dep]);
  await sql.query(
    `insert into public.sessions (deployment_id, date, place, refuse, skip, cancel)
     select deployment_id, session_date,
       count(*) filter (where event = 'place'), count(*) filter (where event = 'refuse'),
       count(*) filter (where event = 'skip'), count(*) filter (where event = 'cancel')
     from public.dry_run_events where deployment_id = $1 and status = 'accepted' group by deployment_id, session_date`,
    [dep],
  );
  await sql.query("update public.deployments set next_line = greatest(next_line, $2) where id = $1", [dep, request.first_line + request.lines.length]);

  const tally = (s: LineResult["status"]) => results.filter((r) => r.status === s).length;
  const response: IngestResponse = {
    batch_id: batchId,
    deployment_id: dep,
    replay: false,
    received: request.lines.length,
    accepted: tally("accepted"),
    duplicate: tally("duplicate"),
    rejected: tally("rejected"),
    ignored: tally("ignored"),
    results,
  };
  await sql.query(
    "update public.ingest_batches set accepted = $2, duplicate = $3, rejected = $4, ignored = $5, result = $6 where id = $1",
    [batchId, response.accepted, response.duplicate, response.rejected, response.ignored, JSON.stringify(response)],
  );
  await audit(sql, actor, "ingest.stored", dep, { batch_id: batchId, accepted: response.accepted, duplicate: response.duplicate, rejected: response.rejected }, requestId);
  return { kind: "stored", response };
}

/** Line number -> ET session date, from the one parser the console has. */
export function sessionDates(lines: { line: number; raw: string }[]): Map<number, string> {
  const max = lines.reduce((m, l) => Math.max(m, l.line), 0);
  const text = new Array<string>(max).fill("");
  for (const l of lines) text[l.line - 1] = l.raw;
  const file = parseDryRun(text.join("\n") + "\n", "stream");
  return new Map(file.events.map((e) => [e.line, e.clock.session]));
}

export async function audit(sql: Sql, actor: string, action: string, target: string, detail: Record<string, unknown>, requestId: string | null) {
  await sql.query("insert into public.audit_log (actor, action, target, detail, request_id) values ($1, $2, $3, $4, $5)", [
    actor,
    action,
    target,
    JSON.stringify(detail),
    requestId,
  ]);
}
