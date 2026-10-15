// A fixed 70/30 split of each set. The guard is tuned on the 70 only; the 30
// is held out and reported on. Changing SEED or the sets reshuffles both.

import { MUST_CATCH } from "./must-catch";
import { MUST_PASS } from "./must-pass";

export const SEED = 20261015;

/** mulberry32: small, seeded, the same on every machine. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function split<T>(items: readonly T[], seed: number): { train: T[]; test: T[] } {
  const next = rng(seed);
  const order = items.map((item) => ({ item, key: next() })).sort((a, b) => a.key - b.key);
  const cut = Math.round(items.length * 0.7);
  return { train: order.slice(0, cut).map((x) => x.item), test: order.slice(cut).map((x) => x.item) };
}

export const CATCH = split(MUST_CATCH, SEED);
export const PASS = split(MUST_PASS, SEED + 1);
