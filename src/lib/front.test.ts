import { describe, expect, it } from "vitest";
import { STATIC_DATASET as ds } from "./data/static";
import { fileOf } from "./data/lookup";
import { heroLine, tickerItems } from "./front";

describe("front door data", () => {
  it("the ticker shows real events of the as-of day, in clock order, each once", () => {
    const items = tickerItems(ds, 1000);
    const expected = ds.deployments.flatMap((d) => fileOf(ds, d.id).sessions.find((s) => s.date === ds.calendar.asOf)?.events ?? []);
    expect(items).toHaveLength(expected.length);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    const minutes = items.map((i) => {
      const [dep, line] = i.key.split(":");
      return fileOf(ds, dep).events.find((e) => e.line === Number(line))!.clock.minuteET;
    });
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
    expect(tickerItems(ds)).toHaveLength(32);
    // Every account shown is a real seed account.
    for (const i of items) expect(ds.accounts.some((a) => a.id === i.account)).toBe(true);
  });

  it("the hero types the first explained refusal of Priya's 7 Oct session, exactly as the engine wrote it", () => {
    const hero = heroLine(ds, "priya-growth", "2026-10-07");
    expect(hero.event.event).toBe("refuse");
    expect(hero.event.symbol).toBe("TSLA");
    expect(hero.explanation.ruleId).toBe("allowlist");
    const lines = ds.files["priya-growth"].split("\n");
    expect(hero.event.raw).toBe(lines[hero.event.line - 1]);
  });

  it("fails loudly when the hero session has nothing to explain", () => {
    expect(() => heroLine(ds, "priya-growth", "1999-01-01")).toThrow(/No explained refusal/);
  });
});
