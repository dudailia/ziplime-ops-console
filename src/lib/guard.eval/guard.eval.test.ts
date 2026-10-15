// The guard measured, not claimed (night run, 15 Oct 2026). Method in
// README.md next to this file. The held-out numbers below were measured once,
// after tuning on the 70% split only; they are floors now, so a change that
// makes the guard worse on unseen text fails here.

import { describe, expect, it } from "vitest";
import { guard, segments } from "../guard";
import { ADVERSARIAL } from "./adversarial";
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

describe("held out (never used for tuning)", () => {
  it("flags none of the 90 support sentences", () => {
    expect(falsePositives(PASS.test).missed).toEqual([]);
  });

  it("catches at least 69 of the 90 (76.7% when measured; 30 of 90 before tuning)", () => {
    expect(catchRate(CATCH.test).caught).toBeGreaterThanOrEqual(69);
  });
});

describe("training split (what the patterns were tuned on)", () => {
  it("catches all 210 and flags none of the 210 support sentences", () => {
    expect(catchRate(CATCH.train).missed).toEqual([]);
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
