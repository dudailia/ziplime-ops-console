// Postgres text and jsonb can't hold a NUL character or half a surrogate pair:
// the insert fails, and in the ingest path that was a 500 (found by
// ingest.fuzz.test.ts, 15 Oct 2026). Every string from a request goes through
// one of these before it is stored. Each such character becomes U+FFFD, the
// mark a reader shows for a character that couldn't be decoded.

export const dbText = (s: string): string => s.toWellFormed().replaceAll("\u0000", "�");

/** JSON for a jsonb column, with every string made storable. */
export const dbJson = (value: unknown): string => JSON.stringify(value, (_key, v) => (typeof v === "string" ? dbText(v) : v));
