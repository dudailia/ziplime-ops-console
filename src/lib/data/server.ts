import "server-only";

// Resolves the configured data source (PLAN.md 15.1, D2 and D3). The mode is
// fixed when the app is built: next.config.ts records CONSOLE_DATA_MODE from
// whether DATABASE_URL was set then. A runtime that disagrees fails loudly.

import { connection } from "next/server";
import { openDb, parseDbUrl, type Db } from "../db/db";
import { migrate } from "../db/migrate";
import { postgresSource } from "./postgres";
import { isEmpty, seedDatabase } from "./seedDb";
import { staticSource, type DataSource } from "./source";
import { STATIC_DATASET } from "./static";
import type { Dataset } from "./types";

export type DataMode = "static" | "database";

export const BUILD_MODE: DataMode = process.env.CONSOLE_DATA_MODE === "database" ? "database" : "static";

/** Null when build and runtime agree; otherwise what's wrong, for the log and the ingest route. */
export function modeMismatch(): string | null {
  const runtime = process.env.DATABASE_URL ? "database" : "static";
  if (runtime === BUILD_MODE) return null;
  return BUILD_MODE === "static"
    ? "DATABASE_URL is set, but this build was made without it, so every page is the static demo. Rebuild with DATABASE_URL set."
    : "This build expects a database, but DATABASE_URL is not set.";
}

let warned = false;

async function openConfigured(): Promise<Db> {
  const url = parseDbUrl(process.env.DATABASE_URL ?? "");
  if (url.driver === "pglite" && process.env.NODE_ENV === "production") {
    throw new Error("pglite: is for development and tests. Use a postgres:// DATABASE_URL in production.");
  }
  const db = await openDb(url);
  if (url.driver === "pglite") {
    // Development convenience only. A real database is migrated with `supabase db push`.
    await migrate(db);
    if (await isEmpty(db)) await seedDatabase(db);
  }
  return db;
}

// One database per process, kept on globalThis so a hot reload never opens a PGlite directory twice.
const holder = globalThis as unknown as { __ziplimeDb?: Promise<Db> };

export async function getDataSource(): Promise<DataSource> {
  const problem = modeMismatch();
  if (problem && !warned) {
    warned = true;
    console.error(`[data] ${problem}`);
  }
  if (BUILD_MODE !== "database") return staticSource;
  if (problem) throw new Error(problem);
  holder.__ziplimeDb ??= openConfigured().catch((exc) => {
    holder.__ziplimeDb = undefined;
    throw exc;
  });
  return postgresSource(await holder.__ziplimeDb);
}

/**
 * The dataset for a server component. A static build returns the bundled seed
 * without waiting on anything, so pages still prerender. A database build
 * waits for a request first, so the build never touches the database.
 */
export async function serverDataset(): Promise<Dataset> {
  if (BUILD_MODE !== "database") return STATIC_DATASET;
  await connection();
  return (await getDataSource()).load();
}
