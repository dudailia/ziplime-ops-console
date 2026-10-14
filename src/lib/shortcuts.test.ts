import { describe, expect, it } from "vitest";
import { GO_TO, resolveKey, SHEET, step } from "./shortcuts";

describe("shortcuts", () => {
  it("g then a letter goes to a page", () => {
    const g = resolveKey(null, "g");
    expect(g).toEqual({ command: null, pending: "g" });
    expect(resolveKey(g.pending, "a")).toEqual({ command: { kind: "go", href: "/ops" }, pending: null });
    expect(resolveKey("g", "S").command).toEqual({ kind: "go", href: "/ops/inbox" });
    expect(resolveKey("g", "z")).toEqual({ command: null, pending: null });
  });

  it("maps the single keys", () => {
    expect(resolveKey(null, "?").command).toEqual({ kind: "help" });
    expect(resolveKey(null, "t").command).toEqual({ kind: "tour" });
    expect(resolveKey(null, "j").command).toEqual({ kind: "next" });
    expect(resolveKey(null, "k").command).toEqual({ kind: "prev" });
    expect(resolveKey(null, "/").command).toEqual({ kind: "search" });
    expect(resolveKey(null, "x").command).toBeNull();
  });

  it("moves through a list and stops at the ends", () => {
    expect(step(-1, 5, 1)).toBe(0);
    expect(step(-1, 5, -1)).toBe(4);
    expect(step(2, 5, 1)).toBe(3);
    expect(step(4, 5, 1)).toBe(4);
    expect(step(0, 5, -1)).toBe(0);
    expect(step(-1, 0, 1)).toBe(-1);
  });

  it("lists every go-to key on the sheet", () => {
    const listed = SHEET[0].items.filter((i) => i.keys[0] === "g").map((i) => i.keys[1]);
    expect(listed.sort()).toEqual(Object.keys(GO_TO).sort());
  });
});
