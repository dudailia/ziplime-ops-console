// One list of checks, run against every adapter (PLAN.md 15.4). Each adapter
// must give back exactly the seed: the same accounts, deployments, tickets
// and signups, and every dry-run file byte for byte.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db/db";
import { freshDb } from "../db/testing";
import { parseDryRun } from "../dryrun/parse";
import { postgresSource } from "./postgres";
import { seedDatabase } from "./seedDb";
import { ReadOnlySourceError, staticSource, type DataSource } from "./source";
import { STATIC_DATASET } from "./static";
import type { Dataset } from "./types";

const seed = STATIC_DATASET;
let db: Db;

const adapters: { name: string; make: () => Promise<DataSource>; writes: boolean }[] = [
  { name: "static", make: async () => staticSource, writes: false },
  {
    name: "postgres (PGlite, seeded through the ingest path)",
    make: async () => {
      db = await freshDb();
      await seedDatabase(db);
      return postgresSource(db);
    },
    writes: true,
  },
];

afterAll(async () => {
  await db?.close();
});

describe.each(adapters)("data source: $name", ({ make, writes }) => {
  let source: DataSource;
  let ds: Dataset;
  beforeAll(async () => {
    source = await make();
    ds = await source.load();
  });

  it("returns the seed's accounts, in order", () => {
    expect(ds.accounts).toEqual(seed.accounts);
  });

  it("returns the seed's deployments, in order", () => {
    expect(ds.deployments).toEqual(seed.deployments);
  });

  it("returns every dry-run file byte for byte", () => {
    expect(Object.keys(ds.files).sort()).toEqual(Object.keys(seed.files).sort());
    for (const id of Object.keys(seed.files)) expect(ds.files[id], id).toBe(seed.files[id]);
  });

  it("parses to the same sessions and counts", () => {
    for (const id of Object.keys(seed.files)) {
      const a = parseDryRun(ds.files[id], id);
      const b = parseDryRun(seed.files[id], id);
      expect(a.sessions.map((s) => [s.date, s.counts]), id).toEqual(b.sessions.map((s) => [s.date, s.counts]));
      expect(a.errors).toEqual(b.errors);
    }
  });

  it("returns the seed's tickets and signups", () => {
    expect(ds.tickets).toEqual(seed.tickets);
    expect(ds.signups).toEqual(seed.signups);
  });

  it("uses the seed's calendar and engine commit", () => {
    expect(ds.calendar).toEqual(seed.calendar);
    expect(ds.ziplime).toEqual(seed.ziplime);
  });

  it("starts with no decisions", () => {
    expect(ds.decisions).toEqual({});
  });

  it.runIf(!writes)("refuses writes", async () => {
    await expect(source.approveSignup({ signupId: "su-001", by: "x", at: "2026-10-14T00:00:00Z", email: { subject: "s", body: "b" } })).rejects.toThrow(ReadOnlySourceError);
    await expect(source.rotateKey("priya-growth", "x")).rejects.toThrow(ReadOnlySourceError);
    expect((await source.ingest("priya-growth", new Uint8Array(), { timestamp: null, signature: null }, new Date())).status).toBe(503);
  });
});

describe("postgres only", () => {
  it("keeps the sessions table equal to the parser's sessions for every deployment", async () => {
    const rows = await db.tx((sql) =>
      sql.query<{ deployment_id: string; date: string; place: number; refuse: number; skip: number; cancel: number }>(
        "select deployment_id, date::text as date, place, refuse, skip, cancel from public.sessions order by deployment_id, date",
      ),
    );
    for (const id of Object.keys(seed.files)) {
      const want = parseDryRun(seed.files[id], id).sessions.map((s) => ({ date: s.date, ...s.counts }));
      const got = rows.filter((r) => r.deployment_id === id).map((r) => ({ date: r.date, place: r.place, refuse: r.refuse, skip: r.skip, cancel: r.cancel }));
      expect(got, id).toEqual(want);
    }
  });

  it("stores one row per seed line, every one accepted", async () => {
    const rows = await db.tx((sql) => sql.query<{ status: string; n: string }>("select status, count(*) as n from public.dry_run_events group by status"));
    const lines = Object.values(seed.files).reduce((n, t) => n + t.split("\n").filter(Boolean).length, 0);
    expect(rows.map((r) => [r.status, Number(r.n)])).toEqual([["accepted", lines]]);
  });
});
