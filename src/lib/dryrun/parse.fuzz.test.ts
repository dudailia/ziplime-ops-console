// parseDryRun reads files people open in the browser: any bytes at all.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { STATIC_DATASET } from "../data/static";
import { fuzz } from "../test/fuzz";
import { parseDryRun } from "./parse";

const ENGINE = Object.values(STATIC_DATASET.files).flatMap((f) => f.trimEnd().split("\n"));

// A line: a real engine line, one cut or changed, JSON of the wrong shape, or anything.
const line = fc.oneof(
  fc.constantFrom(...ENGINE),
  fc.tuple(fc.constantFrom(...ENGINE), fc.nat(), fc.string({ unit: "binary", maxLength: 8 })).map(([l, at, s]) => l.slice(0, at % (l.length + 1)) + s),
  fc.tuple(fc.constantFrom(...ENGINE), fc.string({ maxLength: 12 }), fc.jsonValue({ maxDepth: 2 })).map(([l, key, v]) => {
    const o = JSON.parse(l);
    o[key in o ? key : Object.keys(o)[key.length % Object.keys(o).length]] = v;
    return JSON.stringify(o);
  }),
  fc.json({ maxDepth: 3 }),
  fc.string({ unit: "binary", maxLength: 200 }),
);
const file = fc.tuple(fc.array(line, { maxLength: 30 }), fc.constantFrom("\n", "\r\n"), fc.boolean(), fc.boolean()).map(
  ([lines, eol, bom, trailing]) => (bom ? "﻿" : "") + lines.join(eol) + (trailing ? eol : ""),
);

describe("parseDryRun on anything", () => {
  it("never throws, and every error and event has a line number inside the file", () => {
    fc.assert(
      fc.property(fc.oneof(file, fc.string({ unit: "binary", maxLength: 2000 })), (text) => {
        const parsed = parseDryRun(text, "fuzz.jsonl");
        const count = (text.startsWith("﻿") ? text.slice(1) : text).split("\n").length;
        for (const e of parsed.errors) {
          expect(Number.isInteger(e.line)).toBe(true);
          expect(e.line).toBeGreaterThanOrEqual(1);
          expect(e.line).toBeLessThanOrEqual(count);
        }
        for (const e of parsed.events) {
          expect(e.line).toBeGreaterThanOrEqual(1);
          expect(e.line).toBeLessThanOrEqual(count);
        }
      }),
      fuzz(),
    );
  });
});
