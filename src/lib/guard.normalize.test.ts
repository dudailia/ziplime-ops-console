import { describe, expect, it } from "vitest";
import { normalize } from "./guard.normalize";

const back = (original: string, n: ReturnType<typeof normalize>, start: number, end: number) => original.slice(n.from[start], n.to[end - 1]);

describe("normalize", () => {
  it("leaves plain text alone, one to one", () => {
    const n = normalize("You should set the cap.");
    expect(n.text).toBe("You should set the cap.");
    expect(n.from).toEqual([...n.text].map((_, i) => i));
  });

  it("turns look-alike letters Latin and drops invisible characters", () => {
    const t = "gu\u0430r\u200bant\u0435e";
    const n = normalize(t);
    expect(n.text).toBe("guarantee");
    expect(back(t, n, 0, n.text.length)).toBe(t);
  });

  it("collapses a run of whitespace to one space, or one line break if it holds one, mapping to the whole run", () => {
    const t = "You \t\r\n  should\u00a0buy";
    const n = normalize(t);
    expect(n.text).toBe("You\nshould buy");
    expect(back(t, n, 3, 4)).toBe(" \t\r\n  ");
  });

  it("decomposes fullwidth letters, ligatures and accents", () => {
    expect(normalize("\uff47\uff55\uff41\uff52\uff44").text).toBe("guard");
    expect(normalize("pro\ufb01t").text).toBe("profit");
    expect(normalize("gu\u0301arant\u00e9e").text).toBe("guarantee");
  });

  it("joins words spelled out with one separator, and nothing else", () => {
    expect(normalize("g-u-a-r-a-n-t-e-e it").text).toBe("guarantee it");
    expect(normalize("r.i.s.k-f.r.e.e").text).toBe("risk-free");
    expect(normalize("e.g. a b test, x-y").text).toBe("e.g. a b test, x-y");
    const t = "We g u a r a n t e e";
    const n = normalize(t);
    expect(n.text).toBe("We guarantee");
    expect(back(t, n, 3, 12)).toBe("g u a r a n t e e");
  });

  it("keeps surrogate pairs whole", () => {
    const t = "buy \u{1F680} now";
    const n = normalize(t);
    expect(n.text).toBe(t);
    expect(back(t, n, 4, 6)).toBe("\u{1F680}");
  });
});
