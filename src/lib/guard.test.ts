import { describe, expect, it } from "vitest";
import { guard, segments } from "./guard";

const cats = (text: string, opts = {}) => guard(text, opts).hits.map((h) => h.category);

describe("guard: promised returns", () => {
  it.each([
    "This setup is guaranteed to work.",
    "It's basically risk-free.",
    "You can't lose with a buy-only profile.",
    "The strategy will make money once it's live.",
    "Expect assured profits.",
    "That's a 12% return on the month.",
    "It should outperform SPY.",
    "Built to beat the market.",
  ])("%s", (text) => {
    expect(cats(text)).toEqual(["returns"]);
  });

  it("respects word boundaries and is case-insensitive", () => {
    expect(cats("GUARANTEED fills")).toEqual(["returns"]);
    expect(cats("The guardrail stopped it, and the guard ran.")).toEqual([]);
    expect(cats("Risk limits are free to change.")).toEqual([]);
    expect(cats("The 12% cap on notional")).toEqual([]);
  });
});

describe("guard: investment advice", () => {
  it.each([
    "You should buy AAPL here.",
    "I'd recommend selling into strength.",
    "NVDA is a good investment.",
    "Our price target is 250.",
    "It will go up after earnings.",
    "Now is a good time to add.",
    "Sell now before the close.",
  ])("%s", (text) => {
    expect(cats(text)).toEqual(["advice"]);
  });

  it("allows describing the strategy's own orders", () => {
    expect(cats("Your strategy tried to sell 20 AAPL and the engine refused it.")).toEqual([]);
    expect(cats("You should set ZIPLIME_ALLOWED_SYMBOLS to include TSLA.")).toEqual([]);
  });
});

describe("guard: other clients", () => {
  const otherClients = ["Priya Raman", "LX-40388", "LX***88", "Harbor Lane Capital", "priya.r@example.com"];

  it("blocks any other account's name, company, number, masked id or email", () => {
    for (const term of otherClients) {
      expect(cats(`Same issue as ${term} had.`, { otherClients })).toEqual(["other-clients"]);
    }
  });

  it("blocks generic mentions of other clients", () => {
    expect(cats("Other traders see this too.")).toEqual(["other-clients"]);
    expect(cats("Another customer asked the same.")).toEqual(["other-clients"]);
  });

  it("doesn't match inside a longer token", () => {
    expect(cats("Ticket LX-403881 is unrelated.", { otherClients })).toEqual([]);
  });
});

describe("guard: welcome emails", () => {
  it("blocks Trading Pod promises and ship dates only in intake mode", () => {
    const text = "You'll get access to Trading Pod, and options ship in Q1.";
    expect(cats(text)).toEqual([]);
    expect(cats(text, { intake: true })).toEqual(["pod-promise", "ship-date"]);
    expect(cats("Welcome to the Trading Pod!", { intake: true })).toEqual(["pod-promise"]);
    expect(cats("Futures are coming by March.", { intake: true })).toEqual(["ship-date"]);
    expect(cats("Live on Nov 3rd.", { intake: true })).toEqual(["ship-date"]);
  });

  it("allows a neutral mention of Trading Pod", () => {
    expect(cats("Trading Pod is invite-only. The team reviews track records separately.", { intake: true })).toEqual([]);
  });
});

describe("guard: result shape", () => {
  it("passes clean text", () => {
    expect(guard("Your run placed 5 orders and refused 2. Here is why.")).toEqual({ ok: true, hits: [] });
  });

  it("returns positions that highlight the matched text", () => {
    const text = "Fine. You should buy it. Guaranteed.";
    const { hits } = guard(text);
    expect(hits.map((h) => [h.index, h.match])).toEqual([
      [6, "You should buy"],
      [25, "Guaranteed"],
    ]);
    expect(segments(text, hits).map((s) => [s.text, s.hit?.category ?? null])).toEqual([
      ["Fine. ", null],
      ["You should buy", "advice"],
      [" it. ", null],
      ["Guaranteed", "returns"],
      [".", null],
    ]);
  });
});
