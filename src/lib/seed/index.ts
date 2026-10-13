// Seed data, bundled at build time. The .jsonl files are the engine's own
// output (scripts/generate_seed.py); accounts.json is hand-written.
import accountsJson from "../../../data/seed/accounts.json";
import manifestJson from "../../../data/seed/manifest.json";
import harborMomentum from "../../../data/seed/dryruns/harbor-momentum.jsonl?raw";
import harborEtfCore from "../../../data/seed/dryruns/harbor-etf-core.jsonl?raw";
import priyaGrowth from "../../../data/seed/dryruns/priya-growth.jsonl?raw";
import tomasMeanrev from "../../../data/seed/dryruns/tomas-meanrev.jsonl?raw";
import tomasPairs from "../../../data/seed/dryruns/tomas-pairs.jsonl?raw";
import wenRebalance from "../../../data/seed/dryruns/wen-rebalance.jsonl?raw";
import gretaSector from "../../../data/seed/dryruns/greta-sector.jsonl?raw";
import kofiRebal from "../../../data/seed/dryruns/kofi-rebal.jsonl?raw";
import sofiaSwing from "../../../data/seed/dryruns/sofia-swing.jsonl?raw";
import aaronTrend from "../../../data/seed/dryruns/aaron-trend.jsonl?raw";
import nadiaIntraday from "../../../data/seed/dryruns/nadia-intraday.jsonl?raw";
import nadiaIndexTest from "../../../data/seed/dryruns/nadia-index-test.jsonl?raw";
import jonasBreakout from "../../../data/seed/dryruns/jonas-breakout.jsonl?raw";
import jonasEtf from "../../../data/seed/dryruns/jonas-etf.jsonl?raw";
import { parseDryRun } from "../dryrun/parse";
import type { ParsedFile } from "../dryrun/types";
import type { PlanKey } from "../plans";

export type RiskEnv = Partial<Record<
  | "ZIPLIME_REQUIRE_ORDER_RISK_LIMITS"
  | "ZIPLIME_ALLOW_SELL"
  | "ZIPLIME_MAX_ORDER_QUANTITY"
  | "ZIPLIME_MAX_ORDER_NOTIONAL_USD"
  | "ZIPLIME_MAX_ORDERS_PER_INVOCATION"
  | "ZIPLIME_ALLOWED_SYMBOLS",
  string
>>;

export type Deployment = {
  id: string;
  account: string;
  strategy: string;
  description: string;
  file: string;
  symbols: string[];
  /** null: ran without the fail-closed risk profile. */
  riskEnv: RiskEnv | null;
  validateOrders: boolean;
  deadlines: Record<string, string>;
  sessions: string[];
  lines: number;
};

export type Account = {
  id: string;
  trader: string;
  company: string | null;
  email: string;
  accountNumber: string;
  plan: PlanKey;
  joined: string;
  /** Set when the account came from the Beta intake queue. */
  fromIntake?: string;
};

export const manifest = manifestJson as unknown as {
  asOf: string;
  sessions: string[];
  ziplime: { branch: string; commit: string; subject: string };
  deployments: (Deployment & { counts: Record<string, number> })[];
};

export const AS_OF = manifest.asOf;
/** NYSE sessions in the seed window, ascending. */
export const TRADING_DAYS = manifest.sessions;

export const SEED_ACCOUNTS = accountsJson.accounts as Account[];
export const DEPLOYMENTS: Deployment[] = manifest.deployments;

// One static import per seed file. A test checks this list against the manifest.
export const RAW: Record<string, string> = {
  "harbor-momentum": harborMomentum,
  "harbor-etf-core": harborEtfCore,
  "priya-growth": priyaGrowth,
  "tomas-meanrev": tomasMeanrev,
  "tomas-pairs": tomasPairs,
  "wen-rebalance": wenRebalance,
  "greta-sector": gretaSector,
  "kofi-rebal": kofiRebal,
  "sofia-swing": sofiaSwing,
  "aaron-trend": aaronTrend,
  "nadia-intraday": nadiaIntraday,
  "nadia-index-test": nadiaIndexTest,
  "jonas-breakout": jonasBreakout,
  "jonas-etf": jonasEtf,
};

export function rawSeedFile(deploymentId: string): string {
  const text = RAW[deploymentId];
  if (typeof text !== "string") throw new Error(`No seed file for ${deploymentId}`);
  return text;
}

const parsedCache = new Map<string, ParsedFile>();

export function seedFile(deploymentId: string): ParsedFile {
  let parsed = parsedCache.get(deploymentId);
  if (!parsed) {
    parsed = parseDryRun(rawSeedFile(deploymentId), `${deploymentId}.jsonl`);
    parsedCache.set(deploymentId, parsed);
  }
  return parsed;
}

export function deploymentById(id: string): Deployment | undefined {
  return DEPLOYMENTS.find((d) => d.id === id);
}

export function deploymentsFor(accountId: string): Deployment[] {
  return DEPLOYMENTS.filter((d) => d.account === accountId);
}
