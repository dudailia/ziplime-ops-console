import "server-only";
import { RAW } from "../seed/files";
import { BUILD_MODE } from "./server";
import { STATIC_BASE } from "./staticBase";

/**
 * The dry-run files a page reads, picked on the server and handed to WithFiles
 * as props, so they arrive with the page itself (its HTML on a first load, its
 * server payload on a client navigation) and hydration never waits for them.
 * All of them without ids. Null in database mode, where the dataset the
 * server loaded already holds every file.
 */
export function pageFiles(ids?: readonly string[]): Record<string, string> | null {
  if (BUILD_MODE === "database") return null;
  const keys = ids ?? Object.keys(RAW);
  return Object.fromEntries(keys.filter((k) => Object.hasOwn(RAW, k)).map((k) => [k, RAW[k]]));
}

/** The seeded deployments of one account. */
export function deploymentIdsOf(accountId: string): string[] {
  return STATIC_BASE.deployments.filter((d) => d.account === accountId).map((d) => d.id);
}
