// The static demo's dataset without the dry-run files: accounts, deployments,
// tickets, signups. Small, and what the browser bundle carries. The files come
// per page, through WithFiles (static.ts has the full dataset for the server).

import { SEED_TICKETS } from "../inbox";
import { SIGNUPS } from "../intake";
import { DEPLOYMENTS, manifest, SEED_ACCOUNTS, type Deployment } from "../seed";
import type { Dataset } from "./types";

// The manifest also carries per-file counts for the seed test; pages compute
// counts from the file, so the dataset keeps only the Deployment fields.
function asDeployment(d: Deployment): Deployment {
  return {
    id: d.id,
    account: d.account,
    strategy: d.strategy,
    description: d.description,
    file: d.file,
    symbols: d.symbols,
    riskEnv: d.riskEnv,
    validateOrders: d.validateOrders,
    deadlines: d.deadlines,
    sessions: d.sessions,
    lines: d.lines,
  };
}

export const STATIC_BASE: Dataset = {
  source: "static",
  calendar: { asOf: manifest.asOf, tradingDays: manifest.sessions },
  ziplime: manifest.ziplime,
  accounts: SEED_ACCOUNTS,
  deployments: DEPLOYMENTS.map(asDeployment),
  files: {},
  tickets: SEED_TICKETS,
  signups: SIGNUPS,
  decisions: {},
  ingest: {},
};
