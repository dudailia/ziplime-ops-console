import { describe, expect, it } from "vitest";
import { runRules, type RuleId } from "./automations";
import { guard } from "./guard";
import { currentReply, initialState, reducer, type State } from "./store/state";
import { ticketStatus } from "./inbox/status";

const at = "2026-10-13T16:30:00-04:00";
const all = initialState().rules;
const only = (rule: RuleId) => Object.fromEntries(Object.keys(all).map((k) => [k, k === rule])) as Record<RuleId, boolean>;
const apply = (state: State, enabled = all) => {
  const r = runRules(state, enabled, at);
  return { r, next: reducer(state, { type: "rules/run", run: { id: "run", at, by: "Demo reviewer", lines: r.lines }, tickets: r.tickets, activity: r.activity }) };
};

describe("automation rules on the seed", () => {
  it("opens a ticket for Wen Li's three-session refusal streak, with a clean draft in review", () => {
    const { r, next } = apply(initialState(), only("refusal-streak"));
    const wen = r.tickets.find((t) => t.accountId === "wen-li");
    expect(wen).toBeDefined();
    expect(wen!.links[0].ids.length).toBeGreaterThan(0);
    expect(guard(wen!.draft!.text).hits).toEqual([]);
    expect(ticketStatus(next, wen!)).toBe("in-review");
    expect(currentReply(next, wen!)?.text).toContain("Hi Wen");
    expect(next.sent).toEqual({});
  });

  it("notes the stale deployment and the Lime rejection on the latest session", () => {
    const stale = runRules(initialState(), only("stale"), at);
    expect(stale.activity.map((a) => a.accountId)).toEqual(["nadia-haddad"]);
    expect(stale.activity[0].text).toContain("5 trading days ago");
    const broker = runRules(initialState(), only("broker-rejection"), at);
    expect(broker.activity.map((a) => a.accountId)).toEqual(["sofia-marchetti"]);
  });

  it("flags Harbor Lane momentum as ready for a live review, for a person to act on", () => {
    const ready = runRules(initialState(), only("ready-for-live"), at);
    // Only Harbor Lane: Jonas Weber's breakout refused orders on 7 Oct, inside
    // the same 5-session window the CRM uses, so it isn't ready.
    expect(ready.lines.map((l) => l.deployment)).toEqual(["harbor-momentum"]);
    expect(ready.activity.every((a) => a.text.includes("A person decides"))).toBe(true);
  });

  it("is idempotent: a second run only skips", () => {
    const { next } = apply(initialState());
    const second = runRules(next, all, at);
    expect(second.tickets).toEqual([]);
    expect(second.activity).toEqual([]);
    expect(second.lines.length).toBeGreaterThan(0);
    expect(second.lines.every((l) => l.skipped)).toBe(true);
    expect(second.lines.find((l) => l.rule === "refusal-streak")?.text).toMatch(/^Skipped: ticket A-.* already open\.$/);
  });

  it("runs nothing when every rule is off", () => {
    const off = Object.fromEntries(Object.keys(all).map((k) => [k, false])) as Record<RuleId, boolean>;
    expect(runRules(initialState(), off, at)).toEqual({ tickets: [], activity: [], lines: [] });
  });

  it("keeps the run log newest first and capped", () => {
    let s = initialState();
    for (let i = 0; i < 25; i++) s = reducer(s, { type: "rules/run", run: { id: `r${i}`, at, by: "x", lines: [] }, tickets: [], activity: [] });
    expect(s.runs).toHaveLength(20);
    expect(s.runs[0].id).toBe("r24");
  });
});
