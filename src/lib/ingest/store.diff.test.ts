// The ingest store against the version before 14 Oct 2026, which re-read and
// re-parsed the whole stream on every batch (__fixtures__/store.old.ts). Both
// get the same randomized deliveries: batches out of order, overlaps, replays,
// gaps, holes filled later, cancels in a later batch than their place,
// rejected lines and lines the database refuses. After every batch both
// databases must hold the same rows and return the same HTTP response, and the
// sessions must match a full parse of the accepted lines.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db/db";
import { freshDb } from "../db/testing";
import { parseDryRun } from "../dryrun/parse";
import { storeBatch as storeBatchBefore } from "./__fixtures__/store.old";
import { rng, stream } from "./__fixtures__/stream";
import { httpResult } from "./http";
import { sha256Hex } from "./signature";
import { storeBatch, type StoreInput } from "./store";

const SEEDS = Number(process.env.STORE_DIFF_SEEDS ?? 200);
const TEST_ONLY_CONSTRAINT = "alter table public.dry_run_events add constraint test_only_no_zzzz check (symbol is distinct from 'ZZZZ')";

let before: Db;
let after: Db;

async function setUp(): Promise<Db> {
  const db = await freshDb();
  await db.exec(`insert into public.accounts (id, trader, email, plan, joined) values ('diff', 'Diff', 'diff@x.example', 'beta', '2026-07-01');
    ${TEST_ONLY_CONSTRAINT};`);
  return db;
}

beforeAll(async () => {
  [before, after] = await Promise.all([setUp(), setUp()]);
});
afterAll(async () => {
  await Promise.all([before.close(), after.close()]);
});

const addDeployment = (db: Db, dep: string) =>
  db.tx((sql) => sql.query("insert into public.deployments (id, account_id, strategy, validate_orders) values ($1, 'diff', 'Diff', true)", [dep]));

type Snapshot = {
  events: { row: Record<string, unknown> }[];
  sessions: { row: Record<string, unknown> }[];
  next: { next_line: number }[];
  batches: { row: Record<string, unknown> }[];
  audit: { row: Record<string, unknown> }[];
};

const snapshot = (db: Db, dep: string): Promise<Snapshot> =>
  db.tx(async (sql) => ({
    events: await sql.query("select to_jsonb(e) - 'id' as row from public.dry_run_events e where deployment_id = $1 order by line_no", [dep]),
    // updated_at differs by design: only touched sessions are rewritten now.
    sessions: await sql.query("select to_jsonb(s) - 'updated_at' as row from public.sessions s where deployment_id = $1 order by date", [dep]),
    next: await sql.query("select next_line from public.deployments where id = $1", [dep]),
    batches: await sql.query("select to_jsonb(b) - 'received_at' as row from public.ingest_batches b where deployment_id = $1 order by id", [dep]),
    audit: await sql.query("select jsonb_build_object('actor', actor, 'action', action, 'detail', detail) as row from public.audit_log where target = $1 order by id", [dep]),
  }));

/** Sessions as the parser places the accepted lines, from scratch. */
function fromScratch(s: Snapshot) {
  const accepted = s.events.map((e) => e.row).filter((e) => e.status === "accepted");
  const max = accepted.reduce((m, e) => Math.max(m, Number(e.line_no)), 0);
  const text = new Array<string>(max).fill("");
  for (const e of accepted) text[Number(e.line_no) - 1] = String(e.raw_line);
  const file = parseDryRun(text.join("\n") + "\n", "scratch");
  return {
    sessionOf: Object.fromEntries(file.events.map((e) => [e.line, e.clock.session])),
    counts: file.sessions.map((x) => ({ date: x.date, ...x.counts })),
  };
}

const run = async (db: Db, store: typeof storeBatch, input: StoreInput) => {
  try {
    return httpResult(await db.tx((sql) => store(sql, input)));
  } catch (exc) {
    return { threw: exc instanceof Error ? exc.message : String(exc) };
  }
};

const seen = { batches: 0, replays: 0, gaps: 0, rejected: 0, dbRefused: 0, moved: 0, cancelLater: 0, holesFilled: 0 };

async function deliver(seed: number) {
  const r = rng(seed);
  const dep = `diff-${seed}`;
  await Promise.all([addDeployment(before, dep), addDeployment(after, dep)]);
  const total = r.int(10, 70);
  const lines = stream(r, total, { dbRefused: 0.05 });
  const sent: StoreInput["request"][] = [];
  const holes = new Set<number>();
  let prev: Snapshot | null = null;

  const batches = r.int(6, 18);
  // Random deliveries, then the whole file again in clean chunks, as a
  // forwarder restarting from line 1 would send it: that fills every hole left.
  const sweep = Math.ceil(total / 12);
  for (let k = 0; k < batches + sweep; k++) {
    let request: StoreInput["request"];
    if (k >= batches) {
      const first = (k - batches) * 12 + 1;
      request = { file: `${dep}.jsonl`, first_line: first, lines: lines.slice(first - 1, first + 11) };
      for (let line = first; line < first + 12; line++) if (holes.delete(line)) seen.holesFilled++;
    } else if (sent.length > 0 && r.chance(0.12)) {
      request = r.pick(sent);
      seen.replays++;
    } else {
      const next = Number((await snapshot(before, dep)).next[0].next_line);
      const roll = r.next();
      let first = roll < 0.55 ? next : roll < 0.88 ? r.int(1, next) : next + r.int(1, 4);
      first = Math.min(first, total);
      const last = Math.min(total, first + r.int(0, 11));
      const body: string[] = [];
      for (let line = first; line <= last; line++) {
        const real = lines[line - 1];
        // Place lines go missing more often: a filled place hole is what moves a later cancel.
        const roll2 = r.next() * (real.includes('"event":"place"') ? 0.4 : 1);
        if (roll2 < 0.08) {
          body.push(""); // a hole: ignored now, maybe filled by a later batch
          holes.add(line);
        } else if (roll2 < 0.1) body.push(real.replace('"LX***17"', '"LX***99"')); // a different record at this line
        else if (roll2 < 0.12) body.push(`${real}\n`);
        else {
          if (holes.delete(line)) seen.holesFilled++;
          body.push(real);
        }
      }
      request = { file: `${dep}.jsonl`, first_line: first, lines: body };
      sent.push(request);
    }
    const input: StoreInput = {
      deploymentId: dep,
      batchId: `00000000-0000-4000-8000-${(seed * 100 + k).toString(16).padStart(12, "0")}`,
      bodySha: sha256Hex(JSON.stringify(request)),
      request,
      actor: `forwarder:${dep}`,
      requestId: null,
    };
    const [a, b] = [await run(before, storeBatchBefore, input), await run(after, storeBatch, input)];
    const where = `seed ${seed}, batch ${k}: ${JSON.stringify({ first_line: request.first_line, n: request.lines.length })}`;
    expect(b, where).toEqual(a);
    const [sa, sb] = [await snapshot(before, dep), await snapshot(after, dep)];
    expect(sb, where).toEqual(sa);

    const scratch = fromScratch(sb);
    for (const e of sb.events.map((x) => x.row).filter((x) => x.status === "accepted")) {
      expect(e.session_date, `${where}, line ${e.line_no}`).toBe(scratch.sessionOf[Number(e.line_no)]);
    }
    expect(sb.sessions.map(({ row }) => ({ date: row.date, place: row.place, refuse: row.refuse, skip: row.skip, cancel: row.cancel })), where).toEqual(
      scratch.counts,
    );

    seen.batches++;
    if ("status" in a && a.status === 409) seen.gaps++;
    if ("status" in a && a.status === 200 && "results" in a.body) {
      for (const x of a.body.results) {
        if (x.status === "rejected") seen.rejected++;
        if (x.status === "rejected" && x.reason === "The database refused a value in this record") seen.dbRefused++;
      }
    }
    if (prev) {
      const was = new Map(prev.events.map(({ row }) => [row.line_no, row.session_date]));
      for (const { row } of sb.events) if (was.has(row.line_no) && was.get(row.line_no) !== row.session_date) seen.moved++;
    }
    prev = sb;
  }

  // Cancels stored in a later batch than the place they belong to.
  const rows = prev!.events.map((e) => e.row).filter((e) => e.status === "accepted");
  for (const c of rows.filter((e) => e.event === "cancel")) {
    const place = rows.filter((p) => p.event === "place" && p.dry_run_id === c.dry_run_id && Number(p.line_no) < Number(c.line_no)).at(-1);
    if (place && place.batch_id !== c.batch_id) seen.cancelLater++;
  }
}

describe(`the ingest store, before and after, on ${SEEDS} randomized streams`, () => {
  const CHUNK = 25;
  for (let from = 1; from <= SEEDS; from += CHUNK) {
    const to = Math.min(SEEDS, from + CHUNK - 1);
    it(`seeds ${from} to ${to}`, async () => {
      for (let seed = from; seed <= to; seed++) await deliver(seed);
    }, 120_000);
  }

  it("covered every case it is meant to", () => {
    expect(seen.batches).toBeGreaterThan(SEEDS * 5);
    for (const [name, n] of Object.entries(seen)) expect(n, name).toBeGreaterThan(0);
    console.log(`store.diff: ${JSON.stringify(seen)}`);
  });
});

// The one known difference, and why the random streams never refuse a place:
// the old store gave a cancel the session of a place line the database had
// just refused, in the same batch, and moved it back on the next batch. The
// new one never counts a line that wasn't stored. A refused place is rare in
// practice: the parser rejects every value the schema would.
describe("a place line the database refuses", () => {
  const place = JSON.stringify({
    account: "LX***17", broker_validated: true, client_order_id: "c1", dry_run_id: "dryrun-c1", event: "place", limit_price: null,
    order_dt: "2026-10-05T22:30:00-04:00", order_type: "market", quantity: "5", recorded_at: "2026-10-06T02:30:00.000001+00:00",
    requested_amount: 5, route: "auto", side: "buy", symbol: "ZZZZ", time_in_force: "day", ziplime_order_id: "c1",
  });
  // Written after midnight ET, so by its own clock the cancel is on 6 Oct.
  const cancel = JSON.stringify({ account: "LX***17", dry_run_id: "dryrun-c1", event: "cancel", known_order: true, recorded_at: "2026-10-06T05:00:00.000002+00:00", symbol: null });
  const later = JSON.stringify({ account: "LX***17", event: "skip", order_dt: "2026-10-07T10:00:00-04:00", reason: "0.5 SPY is below one lot (1 share); order not sent", recorded_at: "2026-10-07T14:00:00.000003+00:00", requested_amount: 0.5, symbol: "SPY", ziplime_order_id: "c2" });

  const send = async (db: Db, store: typeof storeBatch, dep: string, k: number, first_line: number, lines: string[]) => {
    const request = { file: "x.jsonl", first_line, lines };
    await db.tx((sql) => store(sql, { deploymentId: dep, batchId: `00000000-0000-4000-9000-${String(k).padStart(12, "0")}`, bodySha: sha256Hex(JSON.stringify(request)), request, actor: "t", requestId: null }));
    return (await snapshot(db, dep)).events.find(({ row }) => row.line_no === 2)!.row.session_date;
  };

  it("doesn't give its session to a cancel; the old store did until the next batch", async () => {
    await Promise.all([addDeployment(before, "refused-place"), addDeployment(after, "refused-place")]);
    expect(await send(after, storeBatch, "refused-place", 1, 1, [place, cancel])).toBe("2026-10-06");
    expect(await send(before, storeBatchBefore, "refused-place", 1, 1, [place, cancel])).toBe("2026-10-05");
    expect(await send(before, storeBatchBefore, "refused-place", 2, 3, [later])).toBe("2026-10-06");
    expect(await send(after, storeBatch, "refused-place", 2, 3, [later])).toBe("2026-10-06");
    const [sa, sb] = [await snapshot(before, "refused-place"), await snapshot(after, "refused-place")];
    expect(sb.events).toEqual(sa.events);
    expect(sb.sessions).toEqual(sa.sessions);
  });
});

// What a batch costs: rows the store reads back, against how many are stored.
describe("one batch's work", () => {
  it("reads rows in proportion to the batch, not to the stored stream", async () => {
    const dep = "cost";
    await addDeployment(after, dep);
    const lines = stream(rng(7), 2010, { bad: 0, repeats: 0 });
    const send = async (first: number, n: number) => {
      let read = 0;
      const request = { file: "cost.jsonl", first_line: first, lines: lines.slice(first - 1, first - 1 + n) };
      await after.tx((sql) =>
        storeBatch(
          { query: async (text, params) => { const rows = await sql.query(text, params); read += rows.length; return rows as never; } },
          { deploymentId: dep, batchId: `00000000-0000-4000-a000-${String(first).padStart(12, "0")}`, bodySha: sha256Hex(JSON.stringify(request)), request, actor: "t", requestId: null },
        ),
      );
      return read;
    };
    for (let first = 1; first <= 2000; first += 500) await send(first, 500);
    // 10 inserts, a few lookups; the old store read all 2,000 stored lines here.
    expect(await send(2001, 10)).toBeLessThan(100);
  });
});
