// The one interface every page and route reads through (PLAN.md 15.4), and
// the static adapter. The Postgres adapter is in ./postgres.

import type { IngestHttpResult } from "../ingest/types";
import type { Account, Deployment } from "../seed";
import { STATIC_DATASET } from "./static";
import type { Dataset, DataSourceKind } from "./types";

export type ApproveInput = { signupId: string; by: string; email: { subject: string; body: string }; at: string };

export type Onboarded = { account: Account; deployment: Deployment; secret: string };

export type ApproveResult =
  | { ok: true; onboarded: Onboarded }
  | { ok: false; status: 404 | 409 | 422; error: "unknown_signup" | "already_decided" | "guard_flagged" };

export interface DataSource {
  readonly kind: DataSourceKind;
  /** Everything the pages read. Database reads run as ops through row-level security. */
  load(): Promise<Dataset>;
  /** One webhook call: raw body bytes and its two headers, checked and stored. */
  ingest(deploymentId: string, body: Uint8Array, headers: { timestamp: string | null; signature: string | null }, now: Date): Promise<IngestHttpResult>;
  /** Approve a Beta signup: account, deployment and ingest key in one transaction. */
  approveSignup(input: ApproveInput): Promise<ApproveResult>;
  /** Issue a new ingest key; the old one stops working at once. Null for an unknown deployment. */
  rotateKey(deploymentId: string, by: string): Promise<{ secret: string } | null>;
}

export class ReadOnlySourceError extends Error {
  constructor() {
    super("The static demo is read only. Set DATABASE_URL to store data.");
  }
}

export const staticSource: DataSource = {
  kind: "static",
  load: async () => STATIC_DATASET,
  ingest: async () => ({ status: 503, body: { error: "ingest_unavailable" } }),
  approveSignup: async () => {
    throw new ReadOnlySourceError();
  },
  rotateKey: async () => {
    throw new ReadOnlySourceError();
  },
};
