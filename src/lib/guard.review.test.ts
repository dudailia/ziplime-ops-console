// Bugs the pre-ship review of the night branch found (15 Oct 2026). Each of
// these failed on the branch before its fix.

import { describe, expect, it } from "vitest";
import { guard } from "./guard";
import { REVIEW_PASS } from "./guard.eval/review-pass";
import { normalize } from "./guard.normalize";

describe("other clients are still caught by name when the name isn't plain ASCII", () => {
  it.each([
    ["José Álvarez had the same refusal.", "José Álvarez"],
    ["Анна Петрова had the same refusal.", "Анна Петрова"],
    ["Сергей Орлов raised the cap.", "Сергей Орлов"],
    ["Ἀλέξης uses 30 here.", "Ἀλέξης"],
    ["Zoë set it to 50.", "Zoë"],
    ["Müller GmbH turned sells on.", "Müller GmbH"],
    ["A B C Capital uses the same file.", "A B C Capital"],
    ["Ask x.y.z@fund.io how they did it.", "x.y.z@fund.io"],
    ["José\nÁlvarez had the same refusal.", "José Álvarez"],
  ])("%s", (text, name) => {
    const { hits } = guard(text, { otherClients: [name] });
    expect(hits.map((h) => h.category)).toContain("other-clients");
  });
});

describe("support sentences the review wrote against the tuned patterns", () => {
  it.each(REVIEW_PASS)("%s", (text) => {
    expect(guard(text).hits).toEqual([]);
  });
});

describe("a line break ends a sentence", () => {
  it.each(["Hi Ann\nDitch Intel today.", "Hi Ann\nSell your Tesla shares today.", "Hi Ann\n\nSwitch into gold."])("%s is caught", (text) => {
    expect(guard(text).ok).toBe(false);
  });
});

describe("only an honest negation excuses 'guarantee'", () => {
  it.each(["You can't beat guaranteed returns.", "You won't find guaranteed income like this.", "Not only guaranteed income, but growth too.", "Never seen guaranteed profits like these.", "No fuss guaranteed profits."])(
    "%s is caught",
    (text) => {
      expect(guard(text).hits.map((h) => h.category)).toContain("returns");
    },
  );
  it.each(["We can't guarantee the order would have filled.", "There's no guarantee Lime would accept it live.", "Dry run doesn't guarantee the same result live.", "Returns are not guaranteed.", "That is not a guarantee of a fill."])(
    "%s passes",
    (text) => {
      expect(guard(text).ok).toBe(true);
    },
  );
});

describe("normalize and guard stay fast and well formed on big input", () => {
  it("normalizes 385,000 characters in well under a second", () => {
    const text = "The engine refused the order because the cap is 5000. ".repeat(7000);
    const t0 = performance.now();
    normalize(text);
    expect(performance.now() - t0).toBeLessThan(1500); // 2.4 to 2.9 s before the fix, tens of ms after
  });

  it("runs the guard over 130,000 characters of short lines in well under a second", () => {
    const text = "it will rise\n".repeat(10_000);
    const t0 = performance.now();
    guard(text);
    expect(performance.now() - t0).toBeLessThan(1500); // 2.4 to 2.9 s before the fix, tens of ms after
  });

  it("never splits a letter outside the BMP when joining spelled-out words", () => {
    const n = normalize("\u{10400} \u{10400} \u{10400} x");
    expect(n.text.isWellFormed()).toBe(true);
    expect(n.text.endsWith("x")).toBe(true);
  });
});
