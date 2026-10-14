// The ingest webhook's wire format (PLAN.md 15.5, openapi.yaml).

import type { LineResult } from "../data/types";

export const LIMITS = {
  bodyBytes: 1_000_000,
  lines: 1000,
  lineBytes: 16 * 1024,
  fileName: 255,
  /** Seconds either way. */
  clockSkew: 300,
} as const;

export type IngestRequest = { file: string | null; first_line: number; lines: string[] };

export type IngestResponse = {
  batch_id: string;
  deployment_id: string;
  replay: boolean;
  received: number;
  accepted: number;
  duplicate: number;
  rejected: number;
  ignored: number;
  results: LineResult[];
};

export type IngestError =
  | "ingest_unavailable"
  | "misconfigured"
  | "too_large"
  | "unauthorized"
  | "stale_timestamp"
  | "bad_request"
  | "gap"
  | "internal";

export type IngestErrorBody = { error: IngestError; reason?: string; expected_at_most?: number; request_id?: string };

export type IngestHttpResult = { status: number; body: IngestResponse | IngestErrorBody };
