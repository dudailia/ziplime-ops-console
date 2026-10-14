// Onboarding in database mode (PLAN.md 15.7): approving a Beta signup creates
// the account, its first deployment and an ingest key in one transaction.
// The secret is returned once and stored only in private.ingest_keys.

import { identifiers } from "../crm";
import type { Sql } from "../db/db";
import { guard } from "../guard";
import { STARTER_PROFILE } from "../ingest/command";
import { newSecret, secretToText } from "../ingest/signature";
import { audit } from "../ingest/store";
import { accountFromSignup } from "../intake";
import type { Account, Deployment } from "../seed";
import type { ApproveInput, ApproveResult } from "./source";

type SignupRow = { id: string; email: string; ts: Date; trade: string[]; style: string[]; funded: string[]; pain: string[]; wants_pod: boolean; note: string | null; page: string; decision: string | null };
type AccountRow = { id: string; trader: string; company: string | null; email: string; account_number: string };

function deploymentFor(account: Account, taken: Set<string>): Deployment {
  const base = `${account.id.slice(0, 56)}-dryrun`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return {
    id,
    account: account.id,
    strategy: "First dry run",
    description: "Created when the signup was approved. Rename it once the trader names the strategy.",
    file: `${id}.jsonl`,
    symbols: [],
    riskEnv: STARTER_PROFILE,
    validateOrders: true,
    deadlines: {},
    sessions: [],
    lines: 0,
  };
}

async function issueKey(sql: Sql, deploymentId: string): Promise<string> {
  const secret = newSecret();
  await sql.query(
    `insert into private.ingest_keys (deployment_id, secret) values ($1, $2)
     on conflict (deployment_id) do update set secret = excluded.secret, created_at = now()`,
    [deploymentId, secret],
  );
  return secretToText(secret);
}

export async function approveSignup(sql: Sql, input: ApproveInput): Promise<ApproveResult> {
  // The signup row lock makes a second approval wait, then see the decision.
  const rows = await sql.query<SignupRow>("select * from public.signups where id = $1 for update", [input.signupId]);
  const row = rows[0];
  if (!row) return { ok: false, status: 404, error: "unknown_signup" };
  if (row.decision) return { ok: false, status: 409, error: "already_decided" };

  // Account ids are chosen under one lock, so two approvals can't pick the same id.
  await sql.query("select pg_advisory_xact_lock(hashtext('ziplime-ops-console:accounts'))");
  const accounts = await sql.query<AccountRow>("select id, trader, company, email, account_number from public.accounts");
  const others = await sql.query<{ email: string }>("select email from public.signups where id <> $1", [input.signupId]);

  // The same guard the browser runs, run again here: the server never trusts the client's check.
  const known = accounts.map((a) => identifiers({ ...a, accountNumber: a.account_number, plan: "beta", joined: "" }));
  const text = `${input.email.subject}\n${input.email.body}`;
  if (!guard(text, { intake: true, otherClients: [...known.flat(), ...others.map((o) => o.email)] }).ok) {
    return { ok: false, status: 422, error: "guard_flagged" };
  }

  const signup = { id: row.id, email: row.email, ts: row.ts.toISOString(), page: row.page, trade: row.trade, style: row.style, funded: row.funded, pain: row.pain, wantsPod: row.wants_pod };
  const account = accountFromSignup(signup, accounts.map((a) => a.id), input.at);
  await sql.query(
    "insert into public.accounts (id, trader, company, email, account_number, plan, joined) values ($1, $2, $3, $4, $5, $6, $7)",
    [account.id, account.trader, account.company, account.email, account.accountNumber, account.plan, account.joined],
  );
  await sql.query("update public.signups set decision = 'approved', decided_by = $2, decided_at = $3, account_id = $4 where id = $1", [
    row.id,
    input.by,
    input.at,
    account.id,
  ]);

  const taken = new Set((await sql.query<{ id: string }>("select id from public.deployments")).map((d) => d.id));
  const deployment = deploymentFor(account, taken);
  await sql.query(
    `insert into public.deployments (id, account_id, strategy, description, symbols, risk_env, validate_orders, deadlines)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [deployment.id, account.id, deployment.strategy, deployment.description, deployment.symbols, JSON.stringify(deployment.riskEnv), true, "{}"],
  );
  const secret = await issueKey(sql, deployment.id);

  await audit(sql, "ops", "signup.approved", account.id, { signup: row.id, deployment: deployment.id, by: input.by, subject: input.email.subject }, null);
  await audit(sql, "ops", "key.issued", deployment.id, { by: input.by }, null);
  return { ok: true, onboarded: { account: { ...account, fromIntake: row.id }, deployment, secret } };
}

export async function rotateKey(sql: Sql, deploymentId: string, by: string): Promise<{ secret: string } | null> {
  const found = await sql.query("select id from public.deployments where id = $1 for update", [deploymentId]);
  if (found.length === 0) return null;
  const had = await sql.query("select 1 from private.ingest_keys where deployment_id = $1", [deploymentId]);
  const secret = await issueKey(sql, deploymentId);
  await audit(sql, "ops", had.length ? "key.rotated" : "key.issued", deploymentId, { by }, null);
  return { secret };
}
