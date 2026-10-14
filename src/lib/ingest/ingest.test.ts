import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db/db";
import { freshDb } from "../db/testing";
import { parseDryRun } from "../dryrun/parse";
import { postgresSource } from "../data/postgres";
import { seedDatabase } from "../data/seedDb";
import { STATIC_DATASET } from "../data/static";
import { handleIngest, parseBody } from "./http";
import { parseHeaders, sha256Hex, sign, signatureMatches, timestampFresh } from "./signature";
import { LIMITS, type IngestErrorBody, type IngestResponse } from "./types";

const VECTORS = JSON.parse(readFileSync(new URL("../../../forwarder/test_vectors.json", import.meta.url), "utf8"));
const enc = new TextEncoder();

// Real engine lines, from a seed file.
const ENGINE = STATIC_DATASET.files["greta-sector"].trimEnd().split("\n");
const SECRET = Buffer.alloc(32, 7);
const DEP = "test-ingest";
const NOW = new Date("2026-10-14T15:00:00Z");
const TS = String(Math.floor(NOW.getTime() / 1000));

let db: Db;

beforeAll(async () => {
  db = await freshDb();
  await seedDatabase(db);
  await db.tx(async (sql) => {
    await sql.query("insert into public.deployments (id, account_id, strategy, validate_orders) values ($1, 'kofi-mensah', 'Ingest test', true)", [DEP]);
    await sql.query("insert into private.ingest_keys (deployment_id, secret) values ($1, $2)", [DEP, SECRET]);
  });
});
afterAll(() => db.close());

type Opts = { ts?: string; secret?: Buffer; signature?: string | null; dep?: string; now?: Date };

async function call(body: unknown, o: Opts = {}) {
  const bytes = typeof body === "string" ? enc.encode(body) : body instanceof Uint8Array ? body : enc.encode(JSON.stringify(body));
  const ts = o.ts ?? TS;
  const signature = o.signature === undefined ? sign(o.secret ?? SECRET, ts, bytes) : o.signature;
  return handleIngest(db, o.dep ?? DEP, bytes, { timestamp: ts, signature }, o.now ?? NOW);
}

const ok = (r: { status: number; body: unknown }) => {
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as IngestResponse;
};

const count = async (q: string, params: unknown[] = []) =>
  Number((await db.tx((sql) => sql.query<{ n: string }>(q, params)))[0].n);

describe("signatures", () => {
  it("match the shared test vector, and the content hash matches too", () => {
    const v = VECTORS.signature;
    expect(sign(Buffer.from(v.secret_hex, "hex"), v.timestamp, enc.encode(v.body))).toBe(v.header);
    expect(sha256Hex(VECTORS.content_hash.line)).toBe(VECTORS.content_hash.sha256);
  });

  it("accept only the exact header shapes", () => {
    const good = `v1=${"a".repeat(64)}`;
    expect(parseHeaders({ timestamp: "1791936000", signature: good })).not.toBeNull();
    for (const signature of [`v1=${"A".repeat(64)}`, `v1=${"a".repeat(63)}`, `v2=${"a".repeat(64)}`, `${"a".repeat(64)}`, `v1=${"a".repeat(64)} `]) {
      expect(parseHeaders({ timestamp: "1791936000", signature }), signature).toBeNull();
    }
    for (const timestamp of ["179193600", "1791936000.5", "-791936000", " 1791936000", null]) {
      expect(parseHeaders({ timestamp, signature: good }), String(timestamp)).toBeNull();
    }
  });

  it("compare in constant time without throwing on a wrong digest", () => {
    const body = enc.encode("x");
    const right = parseHeaders({ timestamp: TS, signature: sign(SECRET, TS, body) })!;
    expect(signatureMatches(SECRET, TS, body, right.digest)).toBe(true);
    expect(signatureMatches(SECRET, TS, enc.encode("y"), right.digest)).toBe(false);
    expect(signatureMatches(SECRET, String(Number(TS) + 1), body, right.digest)).toBe(false);
  });

  it("allow five minutes of clock difference either way, no more", () => {
    expect(timestampFresh(String(Number(TS) - 300), NOW)).toBe(true);
    expect(timestampFresh(String(Number(TS) + 300), NOW)).toBe(true);
    expect(timestampFresh(String(Number(TS) - 301), NOW)).toBe(false);
    expect(timestampFresh(String(Number(TS) + 301), NOW)).toBe(false);
  });
});

describe("body shape", () => {
  it.each([
    ["not JSON", "{lines:", "Body is not valid JSON"],
    ["an array", "[]", "Body must be a JSON object"],
    ["no lines", { first_line: 1, lines: [] }, `"lines" must be a non-empty array`],
    ["a line that isn't a string", { first_line: 1, lines: [1] }, `Every entry in "lines" must be a string`],
    ["line zero", { first_line: 0, lines: ["{}"] }, `"first_line" must be a whole number from 1`],
    ["a fractional line", { first_line: 1.5, lines: ["{}"] }, `"first_line" must be a whole number from 1`],
    ["too many lines", { first_line: 1, lines: new Array(LIMITS.lines + 1).fill("{}") }, `"lines" holds at most 1000 lines`],
  ])("rejects %s", (_name, body, reason) => {
    expect(parseBody(enc.encode(typeof body === "string" ? body : JSON.stringify(body)))).toBe(reason);
  });

  it("rejects bytes that aren't UTF-8", () => {
    expect(parseBody(new Uint8Array([0x7b, 0xff, 0x7d]))).toBe("Body is not valid UTF-8");
  });
});

describe("ingest, in order", () => {
  // These run in sequence on one deployment, like a forwarder would.
  const first = { file: "greta.jsonl", first_line: 1, lines: ENGINE.slice(0, 10) };

  it("stores a clean batch and builds the sessions", async () => {
    const r = ok(await call(first));
    expect(r).toMatchObject({ deployment_id: DEP, replay: false, received: 10, accepted: 10, duplicate: 0, rejected: 0, ignored: 0 });
    expect(r.results.map((x) => x.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(await count("select count(*) as n from public.dry_run_events where deployment_id = $1", [DEP])).toBe(10);
    const sessions = await db.tx((sql) => sql.query<{ date: string; place: number; refuse: number; skip: number; cancel: number }>(
      "select date::text as date, place, refuse, skip, cancel from public.sessions where deployment_id = $1 order by date", [DEP]));
    const want = parseDryRun(ENGINE.slice(0, 10).join("\n") + "\n", "x").sessions.map((s) => ({ date: s.date, ...s.counts }));
    expect(sessions).toEqual(want);
    expect(await count("select next_line as n from public.deployments where id = $1", [DEP])).toBe(11);
  });

  it("answers the same body again with the same result, marked as a replay, and stores nothing", async () => {
    const before = await count("select count(*) as n from public.dry_run_events where deployment_id = $1", [DEP]);
    const again = ok(await call(first));
    const original = await db.tx((sql) => sql.query<{ result: IngestResponse }>(
      "select result from public.ingest_batches where deployment_id = $1 and status = 'stored' order by received_at limit 1", [DEP]));
    expect(again).toEqual({ ...original[0].result, replay: true });
    expect(await count("select count(*) as n from public.dry_run_events where deployment_id = $1", [DEP])).toBe(before);
    expect(await count("select count(*) as n from public.ingest_batches where deployment_id = $1 and status = 'replay'", [DEP])).toBe(1);
  });

  it("calls a line duplicate only at its own line number", async () => {
    const r = ok(await call({ file: "greta.jsonl", first_line: 9, lines: ENGINE.slice(8, 12) }));
    expect(r.results).toEqual([
      { line: 9, status: "duplicate" },
      { line: 10, status: "duplicate" },
      { line: 11, status: "accepted" },
      { line: 12, status: "accepted" },
    ]);
  });

  it("classifies every kind of bad line, and a bad line never blocks a good one", async () => {
    const r = ok(
      await call({
        first_line: 13,
        lines: [
          ENGINE[12], // 13: fine
          '{"event": "place", broken', // 14: not JSON
          "", // 15: blank
          ENGINE[0], // 16: same record as line 1
          ENGINE[13], // 17: fine
          ENGINE[13], // 18: same text earlier in this batch
          "{}\n{}", // 19: a newline inside
          JSON.stringify({ event: "fill" }), // 20: parser rejects
          `{"pad":"${"x".repeat(LIMITS.lineBytes)}"}`, // 21: too long
          ENGINE[14], // 22: fine
        ],
      }),
    );
    const by = Object.fromEntries(r.results.map((x) => [x.line, x]));
    expect(by[13].status).toBe("accepted");
    expect(by[14]).toMatchObject({ status: "rejected" });
    expect(by[14].reason).toMatch(/^Not valid JSON/);
    expect(by[15]).toEqual({ line: 15, status: "ignored", reason: "Blank line" });
    expect(by[16]).toEqual({ line: 16, status: "rejected", reason: "Same record as line 1" });
    expect(by[17].status).toBe("accepted");
    expect(by[18]).toEqual({ line: 18, status: "rejected", reason: "Same record as line 17" });
    expect(by[19]).toEqual({ line: 19, status: "rejected", reason: "A line can't contain a newline" });
    expect(by[20].reason).toMatch(/^Unknown event "fill"/);
    expect(by[21].reason).toMatch(/^Longer than 16 KB/);
    expect(by[22].status).toBe("accepted");
    expect(r).toMatchObject({ accepted: 3, rejected: 6, ignored: 1, duplicate: 0 });
  });

  it("refuses a different record at a line number that is already taken", async () => {
    const r = ok(await call({ first_line: 13, lines: [ENGINE[20]] }));
    expect(r.results).toEqual([{ line: 13, status: "rejected", reason: "Line 13 already holds a different record" }]);
  });

  it("rejects a timestamp Postgres can't store before it gets there", async () => {
    const year0 = ENGINE[15].replace(/"recorded_at": "[^"]+"/, '"recorded_at": "0000-01-01T00:00:00+00:00"');
    expect(year0).not.toBe(ENGINE[15]);
    const r = ok(await call({ first_line: 23, lines: [year0, ENGINE[16]] }));
    expect(r.results[0]).toMatchObject({ line: 23, status: "rejected" });
    expect(r.results[0].reason).toMatch(/ISO timestamp/);
    expect(r.results[1]).toEqual({ line: 24, status: "accepted" });
  });

  it("still rejects only the one line if the database refuses a value the parser allowed", async () => {
    // The last-resort guard: a constraint only the database knows about.
    await db.exec("alter table public.dry_run_events add constraint test_only_no_zzzz check (symbol is distinct from 'ZZZZ')");
    try {
      const zzzz = ENGINE[17].replace(/"symbol": "[^"]+"/, '"symbol": "ZZZZ"');
      const r = ok(await call({ first_line: 25, lines: [zzzz, ENGINE[18]] }));
      expect(r.results).toEqual([
        { line: 25, status: "rejected", reason: "The database refused a value in this record" },
        { line: 26, status: "accepted" },
      ]);
    } finally {
      await db.exec("alter table public.dry_run_events drop constraint test_only_no_zzzz");
    }
  });

  it("rebuilds the file so the parser sees what the trader's file holds", async () => {
    const ds = await postgresSource(db).load();
    const file = parseDryRun(ds.files[DEP], DEP);
    // Parse-rejected lines are stored, so the console reports them at their own numbers.
    // Line 25 is the database-refused case: stored as rejected, but the parser still reads it. That gap is
    // why the parser now checks everything Postgres is known to refuse (PLAN.md 15.10, finding 3).
    expect(file.errors.map((e) => e.line)).toEqual([14, 20, 21, 23]);
    expect(file.events.map((e) => e.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 17, 22, 24, 25, 26]);
    const batches = ds.ingest[DEP];
    expect(batches[0].firstLine).toBe(25);
    expect(batches.find((b) => b.firstLine === 13 && b.rejected === 6)?.rejectedLines.map((l) => l.line)).toEqual([14, 16, 18, 19, 20, 21]);
  });

  it("answers a gap with 409 and the line it expects", async () => {
    const r = await call({ first_line: 30, lines: [ENGINE[29]] });
    expect(r).toEqual({ status: 409, body: { error: "gap", expected_at_most: 27 } });
  });
});

describe("refusals", () => {
  const body = { first_line: 1, lines: [ENGINE[0]] };
  const refusedCount = (target: string, reason: string) =>
    count("select coalesce(sum(count), 0) as n from public.audit_log where action = 'ingest.refused' and target = $1 and detail ->> 'reason' = $2", [target, reason]);

  it("gives a tampered signature 401 and counts it, with no batch row", async () => {
    const batches = await count("select count(*) as n from public.ingest_batches");
    const r = await call(body, { signature: sign(Buffer.alloc(32, 9), TS, enc.encode(JSON.stringify(body))) });
    expect(r).toEqual({ status: 401, body: { error: "unauthorized" } });
    await call(body, { signature: sign(Buffer.alloc(32, 9), TS, enc.encode(JSON.stringify(body))) });
    expect(await refusedCount(DEP, "bad_signature")).toBe(2);
    expect(await count("select count(*) as n from public.ingest_batches")).toBe(batches);
  });

  it("gives a signed body that was changed afterwards 401", async () => {
    const signature = sign(SECRET, TS, enc.encode(JSON.stringify(body)));
    expect((await call({ ...body, first_line: 2 }, { signature })).status).toBe(401);
  });

  it("answers an unknown deployment exactly like a bad signature", async () => {
    expect(await call(body, { dep: "nobody-here" })).toEqual({ status: 401, body: { error: "unauthorized" } });
    expect(await call(body, { dep: "priya-growth" })).toEqual({ status: 401, body: { error: "unauthorized" } }); // real, but has no key
    expect(await call(body, { dep: "../../etc" })).toEqual({ status: 401, body: { error: "unauthorized" } });
    expect(await refusedCount("unknown", "unknown_deployment")).toBe(3);
  });

  it("gives malformed headers 401", async () => {
    expect((await call(body, { signature: "v1=xyz" })).status).toBe(401);
    expect((await call(body, { signature: null })).status).toBe(401);
    expect((await call(body, { ts: "soon" })).status).toBe(401);
  });

  it("gives a timestamp six minutes old 401 stale_timestamp, and records the batch", async () => {
    const ts = String(Number(TS) - 360);
    expect(await call(body, { ts })).toEqual({ status: 401, body: { error: "stale_timestamp" } });
    expect(await count("select count(*) as n from public.ingest_batches where deployment_id = $1 and status = 'stale'", [DEP])).toBe(1);
  });

  it("gives an oversized body 413 before reading anything else", async () => {
    expect(await call(new Uint8Array(LIMITS.bodyBytes + 1), { signature: null })).toEqual({ status: 413, body: { error: "too_large" } });
  });

  it("gives a signed but malformed body 400 with the reason, and records the batch", async () => {
    expect(await call({ first_line: 1, lines: [] })).toEqual({ status: 400, body: { error: "bad_request", reason: `"lines" must be a non-empty array` } });
    expect(await count("select count(*) as n from public.ingest_batches where deployment_id = $1 and status = 'bad_request'", [DEP])).toBe(1);
  });

  it("hides internals on an unexpected failure", async () => {
    const broken: Db = { driver: "pglite", tx: async () => Promise.reject(new Error("relation secret_table does not exist")), exec: async () => {}, close: async () => {} };
    const r = await handleIngest(broken, DEP, enc.encode("{}"), { timestamp: TS, signature: `v1=${"0".repeat(64)}` }, NOW);
    expect(r.status).toBe(500);
    expect(Object.keys(r.body).sort()).toEqual(["error", "request_id"]);
    expect((r.body as IngestErrorBody).error).toBe("internal");
    expect(JSON.stringify(r.body)).not.toMatch(/relation|secret_table/);
  });

  it("never writes the secret into the audit log", async () => {
    const hex = SECRET.toString("hex");
    const rows = await db.tx((sql) => sql.query<{ detail: unknown }>("select detail from public.audit_log"));
    expect(JSON.stringify(rows)).not.toContain(hex);
  });
});

describe("concurrency", () => {
  // PGlite runs one connection and serializes transactions, so the row lock
  // that keeps two batches apart can only be shown on a real Postgres. Point
  // TEST_DATABASE_URL at a throwaway database to run this; it migrates it.
  const url = process.env.TEST_DATABASE_URL;
  it.skipIf(!url)("keeps batches for one deployment apart on a real Postgres (needs TEST_DATABASE_URL)", async () => {
    const { openPg } = await import("../db/db");
    const { migrate } = await import("../db/migrate");
    const pg = await openPg(url!);
    try {
      await migrate(pg);
      const id = `race-${Date.now().toString(36)}`;
      await pg.tx(async (sql) => {
        await sql.query("insert into public.accounts (id, trader, email, plan, joined) values ($1, 'Race', 'race@x.example', 'beta', '2026-10-14')", [id]);
        await sql.query("insert into public.deployments (id, account_id, strategy, validate_orders) values ($1, $1, 'Race', true)", [id]);
        await sql.query("insert into private.ingest_keys (deployment_id, secret) values ($1, $2)", [id, SECRET]);
      });
      const send = (body: unknown) => {
        const bytes = enc.encode(JSON.stringify(body));
        return handleIngest(pg, id, bytes, { timestamp: TS, signature: sign(SECRET, TS, bytes) }, NOW);
      };
      const a = { first_line: 1, lines: ENGINE.slice(0, 20) };
      const b = { first_line: 21, lines: ENGINE.slice(20, 40) };
      const results = await Promise.all([send(a), send(a), send(b), send(b)]);
      // Never a 500. b may arrive before a and get 409 gap, which the forwarder handles by rewinding.
      expect(results.every((r) => r.status === 200 || r.status === 409), JSON.stringify(results.map((r) => r.status))).toBe(true);
      // Whatever the order, a resend of b after a lands cleanly, and nothing was stored twice.
      expect((await send(a)).status).toBe(200);
      expect((await send(b)).status).toBe(200);
      const rows = await pg.tx((sql) => sql.query<{ n: string; next: number }>(
        "select (select count(*) from public.dry_run_events where deployment_id = $1) as n, (select next_line from public.deployments where id = $1) as next", [id]));
      expect(Number(rows[0].n)).toBe(40);
      expect(Number(rows[0].next)).toBe(41);
    } finally {
      await pg.close();
    }
  });
});
