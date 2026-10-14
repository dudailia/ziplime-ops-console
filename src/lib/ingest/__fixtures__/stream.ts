// Seeded dry-run streams for the ingest store tests and benchmark. Lines have
// the shapes lime_trader_sdk_exchange.py writes, and every line is unique, as
// in a real file (recorded_at carries a counter in its microseconds).

/** A small seeded PRNG (mulberry32), so a failing seed can be rerun. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
  };
}
export type Rng = ReturnType<typeof rng>;

const SYMBOLS = ["AAPL", "MSFT", "NVDA", "SPY", "TSLA", "BRK.B"];
const DAYS = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
/** An ET wall time on day (EDT, -04:00) and the same instant in UTC. */
function at(day: string, minute: number, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, 4, 0, 0) + minute * 60_000);
  const et = new Date(utc.getTime() - 4 * 3_600_000);
  const etIso = `${et.getUTCFullYear()}-${pad(et.getUTCMonth() + 1)}-${pad(et.getUTCDate())}T${pad(et.getUTCHours())}:${pad(et.getUTCMinutes())}:00-04:00`;
  const utcIso = `${utc.toISOString().slice(0, 19)}.${pad(n % 1_000_000, 6)}+00:00`;
  return { etIso, utcIso };
}

export type StreamOptions = {
  /** Share of cancels. Cancels point at a recent place, an unknown id, or come before their place. */
  cancels?: number;
  /** Share of lines the parser rejects (bad JSON, a missing field). */
  bad?: number;
  /** Share of refuse/skip/cancel lines with symbol ZZZZ, for a test-only constraint that refuses them in the database. */
  dbRefused?: number;
  /** Share of lines repeating an earlier line exactly ("Same record as line N"). */
  repeats?: number;
};

/** Line i (0-based) of a stream, as the engine would write it. */
export function stream(r: Rng, count: number, o: StreamOptions = {}, start = 0): string[] {
  const { cancels = 0.15, bad = 0.04, dbRefused = 0, repeats = 0.02 } = o;
  const lines: string[] = [];
  const placed: string[] = [];
  for (let i = 0; i < count; i++) {
    const n = start + i;
    if (lines.length > 3 && r.chance(repeats)) {
      lines.push(r.pick(lines));
      continue;
    }
    if (r.chance(bad)) {
      lines.push(r.chance(0.5) ? `{"event": "place", "line": ${n}` : JSON.stringify({ event: "refuse", recorded_at: at(DAYS[0], 600, n).utcIso, n }));
      continue;
    }
    const day = r.pick(DAYS);
    // Most orders in the session, a few late in the evening so a cancel written
    // after midnight ET lands on the next date by its own clock.
    const minute = r.chance(0.2) ? r.int(22 * 60, 23 * 60 + 59) : r.int(9 * 60 + 30, 16 * 60);
    const t = at(day, minute, n);
    const sym = r.pick(SYMBOLS);
    const zid = `z${n.toString(16).padStart(8, "0")}`;
    const account = "LX***17";
    const kind = r.chance(cancels) ? "cancel" : r.pick(["place", "place", "place", "refuse", "skip"] as const);
    const refusedSym = r.chance(dbRefused) ? "ZZZZ" : sym;
    if (kind === "place") {
      // Now and then the same dry_run_id is placed again (the parser warns, the clock uses the latest).
      const id = placed.length > 0 && r.chance(0.05) ? r.pick(placed) : `dryrun-${zid}`;
      placed.push(id);
      const limit = r.chance(0.5);
      lines.push(
        JSON.stringify({
          account,
          broker_validated: r.chance(0.5),
          client_order_id: id.replace("dryrun-", ""),
          dry_run_id: id,
          event: "place",
          limit_price: limit ? `${r.int(10, 900)}.${pad(r.int(0, 99))}` : null,
          order_dt: t.etIso,
          order_type: limit ? "limit" : "market",
          quantity: String(r.int(1, 80)),
          recorded_at: t.utcIso,
          requested_amount: r.int(1, 80),
          route: "auto",
          side: r.chance(0.8) ? "buy" : "sell",
          symbol: sym,
          time_in_force: "day",
          ziplime_order_id: zid,
          ...(r.chance(bad / 2) ? { note: "x".repeat(17_000) } : {}),
        }),
      );
    } else if (kind === "cancel") {
      // A cancel is written up to a day after its order, with no order_dt.
      const later = at(day, minute + r.int(1, 26 * 60), n);
      const roll = r.next();
      const id = roll < 0.65 && placed.length > 0 ? r.pick(placed.slice(-8)) : roll < 0.85 ? `dryrun-z${(n + r.int(1, 6)).toString(16).padStart(8, "0")}` : `unknown-${n}`;
      lines.push(JSON.stringify({ account, dry_run_id: id, event: "cancel", known_order: id.startsWith("dryrun-"), recorded_at: later.utcIso, symbol: r.chance(0.5) ? refusedSym : null }));
    } else {
      const reason = kind === "refuse" ? `ValueError: Lime order symbol '${sym}' is not allowlisted` : `0.${r.int(1, 999)} ${sym} is below one lot (1 share); order not sent`;
      lines.push(
        JSON.stringify({ account, event: kind, order_dt: t.etIso, reason, recorded_at: t.utcIso, requested_amount: r.int(1, 80), symbol: refusedSym, ziplime_order_id: zid }),
      );
    }
  }
  return lines;
}
