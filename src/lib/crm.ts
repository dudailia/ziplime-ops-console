// Per-account rollups for the ops CRM. Pure, over seed data.

import type { Profile } from "./dryrun/explain";
import { readiness } from "./dryrun/metrics";
import { countEvents } from "./dryrun/parse";
import type { EventCounts, ParsedFile } from "./dryrun/types";
import { combineHealth, deploymentHealth, type Calendar, type Health } from "./health";
import { AS_OF, deploymentsFor, seedFile, TRADING_DAYS, type Account, type Deployment } from "./seed";

export const CALENDAR: Calendar = { asOf: AS_OF, tradingDays: TRADING_DAYS };

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

const cache = new Map<string, DeploymentSummary>();

export function summarizeDeployment(d: Deployment): DeploymentSummary {
  const hit = cache.get(d.id);
  if (hit) return hit;
  const file = seedFile(d.id);
  const profile = { riskEnv: d.riskEnv, validateOrders: d.validateOrders };
  const checks = readiness(file, profile);
  const summary = {
    deployment: d,
    file,
    profile,
    health: deploymentHealth(file, profile, CALENDAR, d.strategy),
    counts: countEvents(file.events),
    lastSession: file.sessions.at(-1)?.date ?? null,
    checksPassed: checks.filter((c) => c.pass).length,
    checksTotal: checks.length,
  };
  cache.set(d.id, summary);
  return summary;
}

export function summarizeAccount(account: Account): AccountSummary {
  const deployments = deploymentsFor(account.id).map(summarizeDeployment);
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
