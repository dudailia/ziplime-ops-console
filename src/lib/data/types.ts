// What every page reads, from whichever source is configured (PLAN.md 15.4).
// The static demo gets it from the bundled seed; database mode from Postgres.

import type { Ticket } from "../inbox";
import type { Signup } from "../intake/types";
import type { Account, Deployment } from "../seed";

export type DataSourceKind = "static" | "postgres";

export type SignupDecision = { kind: "approved" | "dismissed"; by: string; at: string; accountId?: string };

export type LineStatus = "accepted" | "duplicate" | "rejected" | "ignored";
export type LineResult = { line: number; status: LineStatus; reason?: string };

/** One authenticated ingest call, as the account page shows it. */
export type IngestBatchView = {
  id: string;
  receivedAt: string;
  status: "stored" | "replay" | "stale" | "bad_request" | "gap";
  file: string | null;
  firstLine: number | null;
  lineCount: number;
  accepted: number;
  duplicate: number;
  rejected: number;
  ignored: number;
  /** Rejected lines with their number and reason. Empty for replays and refused calls. */
  rejectedLines: { line: number; reason: string }[];
};

export type Dataset = {
  source: DataSourceKind;
  calendar: { asOf: string; tradingDays: string[] };
  ziplime: { branch: string; commit: string; subject: string };
  accounts: Account[];
  deployments: Deployment[];
  /** Deployment id -> the dry-run file's text. Line N of the trader's file is line N here. */
  files: Record<string, string>;
  tickets: Ticket[];
  signups: Signup[];
  /** Decisions stored in the database. The static demo keeps them in the browser instead. */
  decisions: Record<string, SignupDecision>;
  /** Per deployment, newest first. */
  ingest: Record<string, IngestBatchView[]>;
};
