// The static adapter's dataset: the bundled seed, exactly the objects the
// demo has always shown. Safe to import on the client; it is what the public
// demo runs on.

import { SEED_TICKETS } from "../inbox";
import { SIGNUPS } from "../intake";
import { DEPLOYMENTS, manifest, RAW, SEED_ACCOUNTS, type Deployment } from "../seed";
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

export const STATIC_DATASET: Dataset = {
  source: "static",
  calendar: { asOf: manifest.asOf, tradingDays: manifest.sessions },
  ziplime: manifest.ziplime,
  accounts: SEED_ACCOUNTS,
  deployments: DEPLOYMENTS.map(asDeployment),
  files: RAW,
  tickets: SEED_TICKETS,
  signups: SIGNUPS,
  decisions: {},
  ingest: {},
};
