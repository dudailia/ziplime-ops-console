import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db/db";
import { freshDb } from "../db/testing";
import { handleIngest } from "../ingest/http";
import { secretFromText, sign } from "../ingest/signature";
import { STARTER_PROFILE } from "../ingest/command";
import { rulesTriage } from "../intake/triage";
import { postgresSource } from "./postgres";
import { seedDatabase } from "./seedDb";
import type { DataSource, Onboarded } from "./source";
import { STATIC_DATASET } from "./static";

const enc = new TextEncoder();
const AT = "2026-10-14T15:00:00.000Z";
const NOW = new Date(AT);
const TS = String(Math.floor(NOW.getTime() / 1000));
const signup = (id: string) => STATIC_DATASET.signups.find((s) => s.id === id)!;
const emailFor = (id: string) => rulesTriage(signup(id)).email;

let db: Db;
let source: DataSource;
let maya: Onboarded;

beforeAll(async () => {
  db = await freshDb();
  await seedDatabase(db);
  source = postgresSource(db);
});
afterAll(() => db.close());

const send = (deploymentId: string, secret: string, body: unknown) => {
  const bytes = enc.encode(JSON.stringify(body));
  return handleIngest(db, deploymentId, bytes, { timestamp: TS, signature: sign(secretFromText(secret)!, TS, bytes) }, NOW);
};

describe("approving a signup in database mode", () => {
  it("creates the account, a deployment with the starter profile, and a key, in one go", async () => {
    const r = await source.approveSignup({ signupId: "su-001", by: "dana", at: AT, email: emailFor("su-001") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    maya = r.onboarded;
    expect(maya.account).toMatchObject({ id: "intake-maya-chen", trader: "Maya Chen", plan: "beta", fromIntake: "su-001", accountNumber: "" });
    expect(maya.deployment).toMatchObject({ id: "intake-maya-chen-dryrun", account: "intake-maya-chen", riskEnv: STARTER_PROFILE, validateOrders: true });
    expect(maya.secret).toMatch(/^[0-9a-f]{64}$/);
    const key = await db.tx((sql) => sql.query<{ secret: Uint8Array }>("select secret from private.ingest_keys where deployment_id = $1", [maya.deployment.id]));
    expect(Buffer.from(key[0].secret).toString("hex")).toBe(maya.secret);
  });

  it("shows up in the dataset: the decision, the account and the deployment", async () => {
    const ds = await source.load();
    expect(ds.decisions["su-001"]).toMatchObject({ kind: "approved", by: "dana", accountId: "intake-maya-chen" });
    expect(ds.accounts.at(-1)).toEqual(maya.account);
    expect(ds.deployments.at(-1)).toMatchObject({ id: maya.deployment.id, riskEnv: STARTER_PROFILE, lines: 0, sessions: [] });
    expect(ds.files[maya.deployment.id]).toBe("");
  });

  it("accepts the first batch signed with the new key", async () => {
    const lines = STATIC_DATASET.files["kofi-rebal"].trimEnd().split("\n").slice(0, 5);
    const r = await send(maya.deployment.id, maya.secret, { file: "first.jsonl", first_line: 1, lines });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ accepted: 5, rejected: 0 });
    const ds = await source.load();
    expect(ds.ingest[maya.deployment.id]).toHaveLength(1);
    expect(ds.ingest[maya.deployment.id][0]).toMatchObject({ status: "stored", file: "first.jsonl", accepted: 5 });
  });

  it("answers a second approval with 409 and issues no second key", async () => {
    const r = await source.approveSignup({ signupId: "su-001", by: "dana", at: AT, email: emailFor("su-001") });
    expect(r).toEqual({ ok: false, status: 409, error: "already_decided" });
    const keys = await db.tx((sql) => sql.query<{ n: string }>("select count(*) as n from private.ingest_keys"));
    expect(Number(keys[0].n)).toBe(1);
  });

  it("runs the guard on the server, and writes nothing when it flags the email", async () => {
    const r = await source.approveSignup({ signupId: "su-002", by: "dana", at: AT, email: { subject: "Welcome", body: "Dana Okafor at Harbor Lane Capital is already in. Guaranteed returns!" } });
    expect(r).toEqual({ ok: false, status: 422, error: "guard_flagged" });
    const ds = await source.load();
    expect(ds.decisions["su-002"]).toBeUndefined();
    expect(ds.accounts).toHaveLength(STATIC_DATASET.accounts.length + 1);
  });

  it("answers an unknown signup with 404", async () => {
    expect(await source.approveSignup({ signupId: "su-999", by: "dana", at: AT, email: emailFor("su-001") })).toEqual({ ok: false, status: 404, error: "unknown_signup" });
  });

  it("keeps the secret out of the audit log", async () => {
    const rows = await db.tx((sql) => sql.query<{ action: string; detail: unknown }>("select action, detail from public.audit_log where actor = 'ops' order by id"));
    expect(rows.map((r) => r.action)).toEqual(["signup.approved", "key.issued"]);
    expect(JSON.stringify(rows)).not.toContain(maya.secret);
  });
});

describe("issuing a new key", () => {
  it("replaces the key: the old one gets 401, the new one works", async () => {
    const out = await source.rotateKey(maya.deployment.id, "dana");
    expect(out?.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(out!.secret).not.toBe(maya.secret);
    const lines = STATIC_DATASET.files["kofi-rebal"].trimEnd().split("\n").slice(5, 7);
    expect((await send(maya.deployment.id, maya.secret, { first_line: 6, lines })).status).toBe(401);
    expect((await send(maya.deployment.id, out!.secret, { first_line: 6, lines })).status).toBe(200);
  });

  it("gives a seeded deployment its first key, and returns null for an unknown one", async () => {
    expect((await source.rotateKey("greta-sector", "dana"))?.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(await source.rotateKey("nobody", "dana")).toBeNull();
    const actions = await db.tx((sql) => sql.query<{ action: string; target: string }>("select action, target from public.audit_log where action like 'key.%' order by id"));
    expect(actions).toEqual([
      { action: "key.issued", target: maya.deployment.id },
      { action: "key.rotated", target: maya.deployment.id },
      { action: "key.issued", target: "greta-sector" },
    ]);
  });
});
