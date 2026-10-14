// Lookups over a Dataset, with each file parsed once per dataset.

import { parseDryRun } from "../dryrun/parse";
import type { ParsedFile } from "../dryrun/types";
import type { Calendar } from "../health";
import type { Deployment } from "../seed";
import type { Dataset } from "./types";

const parsed = new WeakMap<Dataset, Map<string, ParsedFile>>();

/** The deployment's dry-run file, parsed by the one parser the console has. */
export function fileOf(ds: Dataset, deploymentId: string): ParsedFile {
  let cache = parsed.get(ds);
  if (!cache) parsed.set(ds, (cache = new Map()));
  let file = cache.get(deploymentId);
  if (!file) {
    const text = ds.files[deploymentId];
    if (typeof text !== "string") throw new Error(`No dry-run file for ${deploymentId}`);
    file = parseDryRun(text, `${deploymentId}.jsonl`);
    cache.set(deploymentId, file);
  }
  return file;
}

export function deploymentById(ds: Dataset, id: string): Deployment | undefined {
  return ds.deployments.find((d) => d.id === id);
}

export function deploymentsFor(ds: Dataset, accountId: string): Deployment[] {
  return ds.deployments.filter((d) => d.account === accountId);
}

export function calendarOf(ds: Dataset): Calendar {
  return { asOf: ds.calendar.asOf, tradingDays: ds.calendar.tradingDays };
}
