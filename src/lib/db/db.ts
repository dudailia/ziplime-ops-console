// One small interface over the two Postgres drivers: PGlite (embedded, for
// development and tests) and pg (a real server, for example Supabase). Every
// statement runs inside a transaction, so a role or claims set for one
// request can never leak into another request's queries.

export type Row = Record<string, unknown>;

export interface Sql {
  query<T extends Row = Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface Db {
  readonly driver: "pglite" | "pg";
  /** Runs fn in one transaction as the connection's own (owner) role. */
  tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  /** Runs several statements with no parameters, outside a transaction (migrations). */
  exec(text: string): Promise<void>;
  close(): Promise<void>;
}

export type Claims = { app_role?: "ops" | "trader"; account_id?: string };

/**
 * Runs fn as role `authenticated` with the given claims, so row-level
 * security decides what it sees. set_config(..., true) and SET LOCAL end with
 * the transaction.
 */
export function asClaims<T>(db: Db, claims: Claims, fn: (sql: Sql) => Promise<T>): Promise<T> {
  return db.tx(async (sql) => {
    await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await sql.query("set local role authenticated");
    return fn(sql);
  });
}

export const OPS: Claims = { app_role: "ops" };

export type DbUrl = { driver: "pglite"; dir: string | null } | { driver: "pg"; url: string };

/** "pglite:memory", "pglite:<dir>" or "postgres://...". Anything else is a configuration error. */
export function parseDbUrl(url: string): DbUrl {
  if (url === "pglite:memory") return { driver: "pglite", dir: null };
  if (url.startsWith("pglite:")) {
    const dir = url.slice("pglite:".length);
    if (!dir) throw new Error("DATABASE_URL pglite: needs a directory or 'memory'");
    return { driver: "pglite", dir };
  }
  if (/^postgres(ql)?:\/\//.test(url)) return { driver: "pg", url };
  throw new Error("DATABASE_URL must be pglite:memory, pglite:<dir> or a postgres:// URL");
}

export async function openPglite(dir: string | null): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = dir ? new PGlite(dir) : new PGlite();
  await pg.waitReady;
  return {
    driver: "pglite",
    tx: (fn) =>
      pg.transaction((tx) =>
        fn({ query: async <T extends Row>(text: string, params?: readonly unknown[]) => (await tx.query<T>(text, params as unknown[])).rows }),
      ),
    exec: async (text) => {
      await pg.exec(text);
    },
    close: () => pg.close(),
  };
}

export async function openPg(url: string): Promise<Db> {
  const { Pool } = (await import("pg")).default;
  const pool = new Pool({ connectionString: url, max: 3 });
  return {
    driver: "pg",
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn({ query: async <T extends Row>(text: string, params?: readonly unknown[]) => (await client.query(text, params as unknown[])).rows as T[] });
        await client.query("commit");
        return result;
      } catch (exc) {
        await client.query("rollback").catch(() => {});
        throw exc;
      } finally {
        client.release();
      }
    },
    exec: async (text) => {
      await pool.query(text);
    },
    close: () => pool.end(),
  };
}

export function openDb(url: DbUrl): Promise<Db> {
  return url.driver === "pglite" ? openPglite(url.dir) : openPg(url.url);
}
