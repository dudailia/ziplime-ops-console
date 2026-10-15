// One webhook call, end to end (PLAN.md 15.5): size, headers, key, signature,
// timestamp, body shape, then the store. Every failure is a small JSON body
// with no internals; details stay in the server log.

import { randomUUID } from "node:crypto";
import type { Db, Sql } from "../db/db";
import { dbJson } from "../db/text";
import { DUMMY_SECRET, parseHeaders, sha256Hex, signatureMatches, timestampFresh, type Headers } from "./signature";
import { storeBatch, type StoreOutcome } from "./store";
import { LIMITS, type IngestHttpResult, type IngestRequest } from "./types";

const DEPLOYMENT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_FIRST_LINE = 2_000_000_000;

/** Counted per deployment, reason and minute in one audit row, not one row per call. */
async function refused(sql: Sql, target: string, reason: string, requestId: string) {
  await sql.query(
    `insert into public.audit_log (actor, action, target, detail, request_id, bucket, count)
     values ('anonymous', 'ingest.refused', $1, $2, $3, date_trunc('minute', now()), 1)
     on conflict (action, target, (detail ->> 'reason'), bucket) where bucket is not null
     do update set count = public.audit_log.count + 1`,
    [target, JSON.stringify({ reason }), requestId],
  );
}

/** A batch row and an audit row for an authenticated call that went no further. */
async function rejectedBatch(sql: Sql, dep: string, status: "stale" | "bad_request", body: unknown, bodySha: string, actor: string, requestId: string) {
  const id = randomUUID();
  await sql.query("insert into public.ingest_batches (id, deployment_id, status, body_sha256, result) values ($1, $2, $3, $4, $5)", [
    id,
    dep,
    status,
    bodySha,
    dbJson(body),
  ]);
  await sql.query("insert into public.audit_log (actor, action, target, detail, request_id) values ($1, 'ingest.rejected', $2, $3, $4)", [
    actor,
    dep,
    JSON.stringify({ batch_id: id, error: status }),
    requestId,
  ]);
}

/** The body's shape, or the one-line reason it's wrong. */
export function parseBody(bytes: Uint8Array): IngestRequest | string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "Body is not valid UTF-8";
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return "Body is not valid JSON";
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "Body must be a JSON object";
  const v = value as Record<string, unknown>;
  const file = v.file ?? null;
  if (file !== null && (typeof file !== "string" || file.length > LIMITS.fileName)) return `"file" must be a string of at most ${LIMITS.fileName} characters`;
  if (typeof v.first_line !== "number" || !Number.isInteger(v.first_line) || v.first_line < 1 || v.first_line > MAX_FIRST_LINE) {
    return `"first_line" must be a whole number from 1`;
  }
  if (!Array.isArray(v.lines) || v.lines.length === 0) return `"lines" must be a non-empty array`;
  if (v.lines.length > LIMITS.lines) return `"lines" holds at most ${LIMITS.lines} lines`;
  if (!v.lines.every((l): l is string => typeof l === "string")) return `Every entry in "lines" must be a string`;
  return { file, first_line: v.first_line, lines: v.lines };
}

/** The response for what the store did. */
export function httpResult(outcome: StoreOutcome): IngestHttpResult {
  switch (outcome.kind) {
    case "stored":
    case "replay":
      return { status: 200, body: outcome.response };
    case "gap":
      return { status: 409, body: { error: "gap", expected_at_most: outcome.expectedAtMost } };
    case "unknown_deployment":
      return { status: 401, body: { error: "unauthorized" } };
  }
}

export async function handleIngest(db: Db, deploymentId: string, body: Uint8Array, headers: Headers, now: Date): Promise<IngestHttpResult> {
  const requestId = randomUUID();
  const knownShape = DEPLOYMENT_ID.test(deploymentId);
  const target = knownShape ? deploymentId : "unknown";
  try {
    if (body.byteLength > LIMITS.bodyBytes) {
      await db.tx((sql) => refused(sql, target, "too_large", requestId));
      return { status: 413, body: { error: "too_large" } };
    }
    const parsedHeaders = parseHeaders(headers);
    const key = knownShape
      ? await db.tx((sql) => sql.query<{ secret: Uint8Array }>("select secret from private.ingest_keys where deployment_id = $1", [deploymentId]))
      : [];
    // Same work for an unknown deployment as for a real one, so timing reveals nothing.
    const secret = key[0]?.secret ?? DUMMY_SECRET;
    const good = parsedHeaders !== null && signatureMatches(secret, parsedHeaders.timestamp, body, parsedHeaders.digest);
    if (!parsedHeaders || !good || key.length === 0) {
      const reason = !parsedHeaders ? "malformed_headers" : key.length === 0 ? "unknown_deployment" : "bad_signature";
      await db.tx((sql) => refused(sql, key.length === 0 ? "unknown" : deploymentId, reason, requestId));
      return { status: 401, body: { error: "unauthorized" } };
    }

    const actor = `forwarder:${deploymentId}`;
    const bodySha = sha256Hex(body);
    if (!timestampFresh(parsedHeaders.timestamp, now)) {
      const out = { error: "stale_timestamp" } as const;
      await db.tx((sql) => rejectedBatch(sql, deploymentId, "stale", out, bodySha, actor, requestId));
      return { status: 401, body: out };
    }
    const request = parseBody(body);
    if (typeof request === "string") {
      const out = { error: "bad_request", reason: request } as const;
      await db.tx((sql) => rejectedBatch(sql, deploymentId, "bad_request", out, bodySha, actor, requestId));
      return { status: 400, body: out };
    }

    const outcome = await db.tx((sql) => storeBatch(sql, { deploymentId, batchId: randomUUID(), bodySha, request, actor, requestId }));
    return httpResult(outcome);
  } catch (exc) {
    console.error(`[ingest] request ${requestId} failed`, exc);
    return { status: 500, body: { error: "internal", request_id: requestId } };
  }
}
