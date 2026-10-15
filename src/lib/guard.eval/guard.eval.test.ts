// The guard measured, not claimed (night run, 15 Oct 2026). Method in
// README.md next to this file. The numbers below are floors, so a change that
// makes the guard worse on text it wasn't tuned on fails here. The blind set
// is the honest one: its author never saw a pattern, and it was measured once.

import { describe, expect, it } from "vitest";
import { guard, segments } from "../guard";
import { ADVERSARIAL } from "./adversarial";
import { BLIND_CATCH, BLIND_SUPPORT } from "./blind";
import { catchRate, falsePositives } from "./eval";
import { MUST_CATCH } from "./must-catch";
import { MUST_PASS } from "./must-pass";
import { CATCH, PASS } from "./split";

describe("the evaluation sets", () => {
  it("hold 300 texts each, split 210 / 90, with no text in both", () => {
    expect(MUST_CATCH).toHaveLength(300);
    expect(MUST_PASS).toHaveLength(300);
    expect([CATCH.train.length, CATCH.test.length, PASS.train.length, PASS.test.length]).toEqual([210, 90, 210, 90]);
    const pass = new Set(MUST_PASS);
    expect(MUST_CATCH.filter(([t]) => pass.has(t))).toEqual([]);
    expect(new Set(MUST_CATCH.map(([t]) => t)).size).toBe(300);
    expect(pass.size).toBe(300);
  });
});

describe("blind set (another author, never seen the patterns, measured once)", () => {
  it("has 200 support sentences and 120 texts to catch", () => {
    expect([BLIND_SUPPORT.length, BLIND_CATCH.length]).toEqual([200, 120]);
  });

  it("flags none of the 200 support sentences (main flagged 3)", () => {
    expect(falsePositives(BLIND_SUPPORT).missed).toEqual([]);
  });

  it("catches at least 67 of the 120 (55.8% when measured; main caught 37)", () => {
    expect(catchRate(BLIND_CATCH).caught).toBeGreaterThanOrEqual(67);
  });
});

describe("held-out 30% (never tuned on; looked at before, after the first tuning, and after the review)", () => {
  it("flags none of the 90 support sentences", () => {
    expect(falsePositives(PASS.test).missed).toEqual([]);
  });

  it("catches at least 65 of the 90 (72.2% at the last look; 30 of 90 on main)", () => {
    expect(catchRate(CATCH.test).caught).toBeGreaterThanOrEqual(65);
  });
});

describe("training split (what the patterns were tuned on)", () => {
  it("catches at least 205 of 210 and flags none of the 210 support sentences", () => {
    expect(catchRate(CATCH.train).caught).toBeGreaterThanOrEqual(205);
    expect(falsePositives(PASS.train).missed).toEqual([]);
  });
});

describe("adversarial: look-alike letters, invisible characters, spelled-out words", () => {
  it.each(ADVERSARIAL.map((a) => [a.name, a] as const))("%s", (_, a) => {
    const { hits } = guard(a.text);
    expect(hits.map((h) => h.category)).toContain(a.category);
    const spanStart = a.text.indexOf(a.span);
    const spanEnd = spanStart + a.span.length;
    // Every hit points at the original text, and one of them covers the trick.
    for (const h of hits) expect(a.text.slice(h.index, h.index + h.match.length)).toBe(h.match);
    expect(hits.some((h) => h.index <= spanStart && h.index + h.match.length >= spanEnd)).toBe(true);
    // The editor's highlight rebuilds the original exactly.
    expect(segments(a.text, hits).map((s) => s.text).join("")).toBe(a.text);
  });
});
