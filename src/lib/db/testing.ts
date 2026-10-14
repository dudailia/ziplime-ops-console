// Test helpers: a fresh, migrated, in-memory database.
import { openPglite, type Db } from "./db";
import { migrate } from "./migrate";

export async function freshDb(): Promise<Db> {
  const db = await openPglite(null);
  await migrate(db);
  return db;
}

export const HASH = (n: number) => n.toString(16).padStart(64, "0");
