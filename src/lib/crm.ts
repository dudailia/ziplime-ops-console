// Per-account rollups for the ops CRM. Pure, over a Dataset.

import { explain, type Profile } from "./dryrun/explain";
import { readiness } from "./dryrun/metrics";
import { countEvents } from "./dryrun/parse";
import type { EventCounts, ParsedFile } from "./dryrun/types";
import { calendarOf, deploymentsFor, fileOf } from "./data/lookup";
import type { Dataset } from "./data/types";
import { combineHealth, deploymentHealth, type Health } from "./health";
import type { Account, Deployment } from "./seed";

export type DeploymentSummary = {
  deployment: Deployment;
  file: ParsedFile;
  profile: Profile;
  health: Health;
  counts: EventCounts;
  lastSession: string | null;
  checksPassed: number;
  checksTotal: number;
};

export type AccountSummary = {
  account: Account;
  deployments: DeploymentSummary[];
  health: Health;
  lastSession: string | null;
  counts: EventCounts;
};

const caches = new WeakMap<Dataset, Map<string, DeploymentSummary>>();

export function summarizeDeployment(ds: Dataset, d: Deployment): DeploymentSummary {
  let cache = caches.get(ds);
  if (!cache) caches.set(ds, (cache = new Map()));
  const hit = cache.get(d.id);
  if (hit) return hit;
  const file = fileOf(ds, d.id);
  const profile = { riskEnv: d.riskEnv, validateOrders: d.validateOrders };
  const checks = readiness(file, profile);
  const summary = {
    deployment: d,
    file,
    profile,
    health: deploymentHealth(file, profile, calendarOf(ds), d.strategy),
    counts: countEvents(file.events),
    lastSession: file.sessions.at(-1)?.date ?? null,
    checksPassed: checks.filter((c) => c.pass).length,
    checksTotal: checks.length,
  };
  cache.set(d.id, summary);
  return summary;
}

export function summarizeAccount(ds: Dataset, account: Account): AccountSummary {
  const deployments = deploymentsFor(ds, account.id).map((d) => summarizeDeployment(ds, d));
  const lastSession = deployments.map((d) => d.lastSession).filter((s): s is string => s !== null).sort().at(-1) ?? null;
  return {
    account,
    deployments,
    health: deployments.length
      ? combineHealth(deployments.map((d) => d.health))
      : { level: "grey", reasons: [{ level: "grey", text: "No deployments yet" }] },
    lastSession,
    counts: countEvents(deployments.flatMap((d) => d.file.events)),
  };
}

/** Everything that identifies an account, for the guard's other-clients check. */
export function identifiers(a: Account): string[] {
  return [a.trader, a.company ?? "", a.accountNumber, maskOf(a.accountNumber), a.email].filter(Boolean);
}

function maskOf(value: string): string {
  return value.length <= 4 ? "****" : `${value.slice(0, 2)}***${value.slice(-2)}`;
}

export function otherClients(accountId: string, accounts: readonly Account[]): string[] {
  return accounts.filter((a) => a.id !== accountId).flatMap(identifiers);
}

export type FrontDoorNumbers = {
  orders: number;
  sessions: number;
  deployments: number;
  refused: number;
  explained: number;
  needHelp: number;
  accounts: number;
};

/** The three numbers on the front door, straight from the dry-run files. Cancels aren't orders. */
export function frontDoorNumbers(ds: Dataset, accounts: readonly Account[] = ds.accounts): FrontDoorNumbers {
  const n: FrontDoorNumbers = { orders: 0, sessions: 0, deployments: ds.deployments.length, refused: 0, explained: 0, needHelp: 0, accounts: accounts.length };
  for (const d of ds.deployments) {
    const s = summarizeDeployment(ds, d);
    n.orders += s.counts.place + s.counts.refuse + s.counts.skip;
    n.sessions += s.file.sessions.length;
    n.refused += s.counts.refuse;
    for (const e of s.file.events) if (e.event === "refuse" && explain(e, s.profile)?.detailKnown) n.explained += 1;
  }
  n.needHelp = accounts.map((a) => summarizeAccount(ds, a)).filter((a) => a.health.level === "red").length;
  return n;
}
