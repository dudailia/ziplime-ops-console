// npm run db:migrate / npm run db:seed, against DATABASE_URL.
// On Supabase, prefer `supabase db push` for migrations; db:migrate is for a
// plain Postgres without the Supabase CLI. db:seed loads the bundled seed into
// an empty database through the same ingest store the webhook uses, and
// refuses to touch a database that already has accounts.

import { describe, expect, it } from "vitest";
import { openDb, parseDbUrl } from "../src/lib/db/db";
import { migrate } from "../src/lib/db/migrate";
import { isEmpty, seedDatabase } from "../src/lib/data/seedDb";

const task = process.env.DB_TASK;
const url = process.env.DATABASE_URL;

describe(`database task: ${task ?? "none"}`, () => {
  it.runIf(task === "migrate")("applies supabase/migrations", async () => {
    const db = await openDb(parseDbUrl(url ?? ""));
    try {
      const applied = await migrate(db);
      console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Already up to date.");
    } finally {
      await db.close();
    }
  });

  it.runIf(task === "seed")("loads the bundled seed into an empty database", async () => {
    const db = await openDb(parseDbUrl(url ?? ""));
    try {
      expect(await isEmpty(db), "The database already has accounts; db:seed only fills an empty one.").toBe(true);
      await seedDatabase(db);
      console.log("Seed loaded: 10 accounts, 14 deployments, every dry-run line through the ingest store.");
    } finally {
      await db.close();
    }
  });
});
