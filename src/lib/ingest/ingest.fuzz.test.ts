// The webhook takes bytes from the internet. Whatever arrives, signed or not,
// it must answer with a 4xx or a 2xx, never a 500, and what it says it stored
// must be in the database.
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db/db";
import { freshDb } from "../db/testing";
import { STATIC_DATASET } from "../data/static";
import { fuzz } from "../test/fuzz";
import { handleIngest } from "./http";
import { sign } from "./signature";
import { LIMITS } from "./types";

const SECRET = Buffer.alloc(32, 9);
const DEP = "fuzz-dep";
const NOW = new Date("2026-10-15T15:00:00Z");
const TS = String(Math.floor(NOW.getTime() / 1000));
const enc = new TextEncoder();
const ENGINE = STATIC_DATASET.files["greta-sector"].trimEnd().split("\n");

let db: Db;
beforeAll(async () => {
  db = await freshDb();
  await db.exec(`insert into public.accounts (id, trader, email, plan, joined) values ('fuzz', 'Fuzz', 'fuzz@x.example', 'beta', '2026-07-01');
    insert into public.deployments (id, account_id, strategy, validate_orders) values ('${DEP}', 'fuzz', 'Fuzz', true);`);
  await db.tx((sql) => sql.query("insert into private.ingest_keys (deployment_id, secret) values ($1, $2)", [DEP, SECRET]));
});
afterAll(() => db.close());

const weird = fc.constantFrom("\u0000", "\ud800", "\udfff", "\u{1F680}", "​", "\\u0000", '"', "\\", " ", "x".repeat(LIMITS.lineBytes + 1), "é".repeat(9000));
const line = fc.oneof(
  fc.constantFrom(...ENGINE),
  fc.tuple(fc.constantFrom(...ENGINE), fc.nat(), weird).map(([l, at, w]) => l.slice(0, at % (l.length + 1)) + w + l.slice(at % (l.length + 1))),
  fc.string({ unit: "binary", maxLength: 80 }),
  weird,
  fc.json({ maxDepth: 2 }),
);
const firstLine = fc.oneof(fc.integer({ min: 1, max: 40 }), fc.constantFrom(0, -1, 1.5, 2_000_000_000, 2_147_483_647, Number.MAX_SAFE_INTEGER, 1e308), fc.string({ maxLength: 4 }));
const shaped = fc.record({ file: fc.oneof(fc.constant(null), fc.string({ unit: "binary", maxLength: 20 }), fc.integer()), first_line: firstLine, lines: fc.array(line, { minLength: 0, maxLength: 12 }) });
const bodyBytes = fc.oneof(
  { weight: 6, arbitrary: shaped.map((b) => enc.encode(JSON.stringify(b))) },
  { weight: 1, arbitrary: fc.uint8Array({ maxLength: 200 }) },
  { weight: 1, arbitrary: fc.jsonValue({ maxDepth: 3 }).map((v) => enc.encode(JSON.stringify(v) ?? "null")) },
);
const headers = (body: Uint8Array) =>
  fc.oneof(
    { weight: 6, arbitrary: fc.constant({ timestamp: TS, signature: sign(SECRET, TS, body) }) },
    { weight: 1, arbitrary: fc.record({ timestamp: fc.oneof(fc.constant(null), fc.string({ maxLength: 12 }), fc.constant(TS)), signature: fc.oneof(fc.constant(null), fc.string({ maxLength: 70 })) }) },
  );
const deployment = fc.oneof({ weight: 8, arbitrary: fc.constant(DEP) }, { weight: 1, arbitrary: fc.string({ unit: "binary", maxLength: 70 }) });

describe("ingest on anything", () => {
  it(
    "never answers 500, and every line it calls accepted or rejected is stored",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          bodyBytes.chain((body) => fc.tuple(fc.constant(body), headers(body), deployment)),
          async ([body, h, dep]) => {
            const result = await handleIngest(db, dep, body, h, NOW);
            expect(result.status, JSON.stringify(result.body)).not.toBe(500);
            if (result.status !== 200 || !("results" in result.body) || result.body.replay) return;
            const response = result.body;
            const rows = await db.tx((sql) =>
              sql.query<{ line_no: number; status: string }>("select line_no, status from public.dry_run_events where batch_id = $1", [response.batch_id]),
            );
            const stored = new Map(rows.map((r) => [Number(r.line_no), r.status]));
            for (const r of response.results) {
              // These three are refused before storing, by design: the line would collide with a
              // stored row (same content, or a different record at its line number), or isn't a line.
              const notStored = r.status === "rejected" && /^(?:Same record as line \d+|Line \d+ already holds a different record|A line can't contain a newline)$/.test(r.reason ?? "");
              if ((r.status === "accepted" || r.status === "rejected") && !notStored) {
                expect(stored.get(r.line), `line ${r.line} reported ${r.status} (${r.reason ?? ""})`).toBe(r.status);
              }
            }
          },
        ),
        fuzz(),
      );
    },
    600_000,
  );
});
