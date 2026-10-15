// The guard runs on every keystroke in the reply editor: any text at all.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { guard, segments } from "./guard";
import { MUST_CATCH } from "./guard.eval/must-catch";
import { fuzz } from "./test/fuzz";

const TRICKS = ["​", "­", "﻿", "́", " ", "\n", "\r\n", "  ", "а", "о", "ο", "-", ".", " ", "ﬁ", "ｇ", "\ud800", "\udc00", "\u{1F680}"];

// A known phrase with tricks pushed in at random places, or anything.
const tricked = fc.tuple(fc.constantFrom(...MUST_CATCH.map(([t]) => t)), fc.array(fc.tuple(fc.nat(), fc.constantFrom(...TRICKS)), { maxLength: 6 })).map(([t, ins]) => {
  let s = t;
  for (const [at, x] of ins) {
    const i = at % (s.length + 1);
    s = s.slice(0, i) + x + s.slice(i);
  }
  return s;
});
const text = fc.oneof(tricked, fc.string({ unit: "binary", maxLength: 300 }), fc.string({ unit: "grapheme", maxLength: 100 }));
const options = fc.record({ intake: fc.boolean(), otherClients: fc.array(fc.string({ unit: "binary", maxLength: 12 }), { maxLength: 3 }) });

describe("guard on anything", () => {
  it("never throws, and every hit slices back out of the original text exactly", () => {
    fc.assert(
      fc.property(text, options, (t, o) => {
        const { ok, hits } = guard(t, o);
        expect(ok).toBe(hits.length === 0);
        let end = 0;
        for (const h of hits) {
          expect(h.index).toBeGreaterThanOrEqual(end); // sorted, not overlapping
          expect(h.match.length).toBeGreaterThan(0);
          expect(t.slice(h.index, h.index + h.match.length)).toBe(h.match);
          end = h.index + h.match.length;
        }
        expect(end).toBeLessThanOrEqual(t.length);
        expect(segments(t, hits).map((s) => s.text).join("")).toBe(t);
      }),
      fuzz(),
    );
  });
});
