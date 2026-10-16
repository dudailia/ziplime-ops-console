// Seed data, bundled at build time; accounts.json is hand-written. The .jsonl
// files, the engine's own output (scripts/generate_seed.py), are in ./files,
// which only the server imports: pages get them through WithFiles. Pages read
// all of it through the data source (lib/data), never from here directly.
import accountsJson from "../../../data/seed/accounts.json";
import manifestJson from "../../../data/seed/manifest.json";
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
