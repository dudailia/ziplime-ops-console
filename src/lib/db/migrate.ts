// Applies supabase/migrations/*.sql in name order, once each. Used for PGlite
// only: on a real project, `supabase db push` runs the same files and keeps
// its own record. The app never migrates a postgres:// database itself.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./db";

export const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

export function migrationFiles(dir = MIGRATIONS_DIR): { name: string; sql: string }[] {
  return readdirSync(dir)
    .filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}

export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(`create schema if not exists ziplime_meta;
    create table if not exists ziplime_meta.migrations (name text primary key, applied_at timestamptz not null default now());`);
  const done = new Set(
    (await db.tx((sql) => sql.query<{ name: string }>("select name from ziplime_meta.migrations"))).map((r) => r.name),
  );
  const applied: string[] = [];
  for (const m of migrationFiles(dir)) {
    if (done.has(m.name)) continue;
    // The file and its bookkeeping row commit together. The name is safe to
    // inline: migrationFiles only accepts [0-9a-z_.] names.
    try {
      await db.exec(`begin;\n${m.sql}\n;insert into ziplime_meta.migrations (name) values ('${m.name}');\ncommit;`);
    } catch (exc) {
      await db.exec("rollback").catch(() => {});
      throw new Error(`Migration ${m.name} failed: ${exc instanceof Error ? exc.message : String(exc)}`);
    }
    applied.push(m.name);
  }
  return applied;
}
