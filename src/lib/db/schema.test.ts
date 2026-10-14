import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asClaims, OPS, type Db } from "./db";
import { migrate } from "./migrate";
import { freshDb, HASH } from "./testing";

// Two traders, each with one deployment, one batch, one event, one session
// and one ticket; one signup; one audit row; one key. Inserted as the owner.
const FIXTURE = `
insert into public.accounts (id, trader, email, account_number, plan, joined) values
  ('acct-a', 'Ann A', 'ann@a.example', 'LX-1', 'beta', '2026-07-01'),
  ('acct-b', 'Ben B', 'ben@b.example', 'LX-2', 'beta', '2026-07-02');
insert into public.deployments (id, account_id, strategy, validate_orders) values
  ('dep-a', 'acct-a', 'A strategy', true), ('dep-b', 'acct-b', 'B strategy', true);
insert into private.ingest_keys (deployment_id, secret) values ('dep-a', decode(repeat('ab', 32), 'hex'));
insert into public.ingest_batches (id, deployment_id, status, body_sha256, first_line, line_count, accepted, result) values
  ('00000000-0000-4000-8000-00000000000a', 'dep-a', 'stored', '${HASH(1)}', 1, 1, 1, '{}'),
  ('00000000-0000-4000-8000-00000000000b', 'dep-b', 'stored', '${HASH(2)}', 1, 1, 1, '{}');
insert into public.dry_run_events (deployment_id, batch_id, line_no, raw_line, content_hash, status, event, recorded_at,
  ziplime_order_id, symbol, requested_amount, reason, session_date) values
  ('dep-a', '00000000-0000-4000-8000-00000000000a', 1, '{}', '${HASH(3)}', 'accepted', 'refuse', now(), 'z1', 'TSLA', 5, 'r', '2026-10-09'),
  ('dep-b', '00000000-0000-4000-8000-00000000000b', 1, '{}', '${HASH(4)}', 'accepted', 'refuse', now(), 'z2', 'AMD', 5, 'r', '2026-10-09');
insert into public.sessions (deployment_id, date, refuse) values ('dep-a', '2026-10-09', 1), ('dep-b', '2026-10-09', 1);
insert into public.tickets (id, account_id, subject, created_at) values ('T-1', 'acct-a', 'A', now()), ('T-2', 'acct-b', 'B', now());
insert into public.signups (id, email, ts, page) values ('su-1', 'new@x.example', now(), '/');
insert into public.audit_log (actor, action, target) values ('ops', 'key.issued', 'dep-a');
`;

const PUBLIC_TABLES = ["accounts", "signups", "deployments", "ingest_batches", "dry_run_events", "sessions", "tickets", "audit_log"];

let db: Db;

beforeAll(async () => {
  db = await freshDb();
  await db.exec(FIXTURE);
});
afterAll(() => db.close());

const count = (claims: Parameters<typeof asClaims>[1], table: string) =>
  asClaims(db, claims, async (sql) => Number((await sql.query<{ n: string }>(`select count(*) as n from public.${table}`))[0].n));

describe("migrations", () => {
  it("apply once: a second run changes nothing", async () => {
    expect(await migrate(db)).toEqual([]);
  });
});

describe("grants", () => {
  it("turns row-level security on for every table in public", async () => {
    const rows = await db.tx((sql) =>
      sql.query<{ relname: string; relrowsecurity: boolean }>(
        `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r'`,
      ),
    );
    expect(rows.map((r) => r.relname).sort()).toEqual([...PUBLIC_TABLES].sort());
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("gives anon nothing, anywhere", async () => {
    const rows = await db.tx((sql) =>
      sql.query<{ t: string; any: boolean }>(
        `select n.nspname || '.' || c.relname as t,
           has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger') as any
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname in ('public', 'private') and c.relkind = 'r'`,
      ),
    );
    expect(rows.length).toBeGreaterThan(8);
    expect(rows.filter((r) => r.any)).toEqual([]);
  });

  it("lets authenticated select public tables and nothing else", async () => {
    const rows = await db.tx((sql) =>
      sql.query<{ t: string; sel: boolean; write: boolean }>(
        `select n.nspname || '.' || c.relname as t,
           has_table_privilege('authenticated', c.oid, 'select') as sel,
           has_table_privilege('authenticated', c.oid, 'insert, update, delete, truncate') as write
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname in ('public', 'private') and c.relkind = 'r'`,
      ),
    );
    for (const r of rows) {
      expect(r.write, r.t).toBe(false);
      expect(r.sel, r.t).toBe(r.t.startsWith("public."));
    }
  });

  it("refuses a write from authenticated, even as ops", async () => {
    await expect(asClaims(db, OPS, (sql) => sql.query("insert into public.signups (id, email, ts, page) values ('su-x', 'x@x.example', now(), '/')"))).rejects.toThrow(/permission denied/);
  });

  it("never lets a client role read an ingest key", async () => {
    await expect(asClaims(db, OPS, (sql) => sql.query("select * from private.ingest_keys"))).rejects.toThrow(/permission denied/);
  });
});

describe("row-level security", () => {
  const A = { app_role: "trader", account_id: "acct-a" } as const;

  it("shows a trader only their own rows in every table they can read", async () => {
    for (const table of ["accounts", "deployments", "ingest_batches", "dry_run_events", "sessions", "tickets"]) {
      expect(await count(A, table), table).toBe(1);
    }
    const ids = await asClaims(db, A, (sql) => sql.query<{ id: string }>("select id from public.deployments"));
    expect(ids).toEqual([{ id: "dep-a" }]);
  });

  it("shows a trader no signups and no audit rows", async () => {
    expect(await count(A, "signups")).toBe(0);
    expect(await count(A, "audit_log")).toBe(0);
  });

  it("shows ops every row", async () => {
    expect(await count(OPS, "accounts")).toBe(2);
    expect(await count(OPS, "dry_run_events")).toBe(2);
    expect(await count(OPS, "signups")).toBe(1);
    expect(await count(OPS, "audit_log")).toBe(1);
  });

  it("fails closed with no claims, or with a claim for an account that isn't there", async () => {
    for (const table of PUBLIC_TABLES) expect(await count({}, table), table).toBe(0);
    expect(await count({ app_role: "trader", account_id: "acct-z" }, "accounts")).toBe(0);
  });

  it("would catch a leak: with RLS off, the trader test sees both accounts", async () => {
    // Sanity check on the tests themselves, rolled back afterwards.
    await expect(
      db.tx(async (sql) => {
        await sql.query("alter table public.accounts disable row level security");
        await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(A)]);
        await sql.query("set local role authenticated");
        const n = Number((await sql.query<{ n: string }>("select count(*) as n from public.accounts"))[0].n);
        throw new Error(`saw ${n}`);
      }),
    ).rejects.toThrow("saw 2");
    expect(await count(A, "accounts")).toBe(1);
  });
});

describe("constraints", () => {
  const insertEvent = (cols: string, vals: string) =>
    db.tx((sql) =>
      sql.query(
        `insert into public.dry_run_events (deployment_id, batch_id, line_no, raw_line, content_hash, status, ${cols})
         values ('dep-a', '00000000-0000-4000-8000-00000000000a', ${vals})`,
      ),
    );

  it("rejects an unknown event type", async () => {
    await expect(insertEvent("event, recorded_at, session_date", `9, '{}', '${HASH(10)}', 'accepted', 'fill', now(), '2026-10-09'`)).rejects.toThrow(/check/);
  });

  it("rejects a place without a side", async () => {
    await expect(
      insertEvent(
        "event, recorded_at, session_date, dry_run_id, client_order_id, ziplime_order_id, symbol, quantity, order_type, broker_validated",
        `9, '{}', '${HASH(11)}', 'accepted', 'place', now(), '2026-10-09', 'dryrun-x', 'x', 'z', 'SPY', 1, 'market', true`,
      ),
    ).rejects.toThrow(/check/);
  });

  it("rejects a rejected line that claims an event", async () => {
    await expect(insertEvent("reject_reason, event", `9, '{}', '${HASH(12)}', 'rejected', 'bad', 'place'`)).rejects.toThrow(/check/);
  });

  it("never stores the same line twice, by content or by line number", async () => {
    await expect(insertEvent("reject_reason", `9, '{}', '${HASH(3)}', 'rejected', 'bad'`)).rejects.toThrow(/unique|duplicate/);
    await expect(insertEvent("reject_reason", `1, '{}', '${HASH(13)}', 'rejected', 'bad'`)).rejects.toThrow(/unique|duplicate/);
  });

  it("needs a real deployment and a 32-byte key", async () => {
    await expect(db.tx((sql) => sql.query("insert into public.deployments (id, account_id, strategy, validate_orders) values ('dep-c', 'nobody', 's', true)"))).rejects.toThrow(/foreign key/);
    await expect(db.tx((sql) => sql.query("insert into private.ingest_keys (deployment_id, secret) values ('dep-b', 'short')"))).rejects.toThrow(/check/);
  });

  it("keeps a decision and its account together", async () => {
    await expect(db.tx((sql) => sql.query("update public.signups set decision = 'approved', decided_by = 'x', decided_at = now() where id = 'su-1'"))).rejects.toThrow(/check/);
  });
});
