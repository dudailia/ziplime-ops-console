import { describe, expect, it } from "vitest";
import { runRules, type RuleId } from "./automations";
import { STATIC_DATASET as ds } from "./data/static";
import { guard } from "./guard";
import { currentReply, initialState, reducer, type State } from "./store/state";
import { ticketStatus } from "./inbox/status";
import { shortDate } from "./format";

const at = "2026-10-13T16:30:00-04:00";
const all = initialState().rules;
const only = (rule: RuleId) => Object.fromEntries(Object.keys(all).map((k) => [k, k === rule])) as Record<RuleId, boolean>;
const apply = (state: State, enabled = all) => {
  const r = runRules(ds, state, enabled, at);
  return { r, next: reducer(state, { type: "rules/run", run: { id: "run", at, by: "Demo reviewer", lines: r.lines }, tickets: r.tickets, activity: r.activity }, ds) };
};

describe("automation rules on the seed", () => {
  it("opens a ticket for Wen Li's three-session refusal streak, with a clean draft in review", () => {
    const { r, next } = apply(initialState(), only("refusal-streak"));
    const wen = r.tickets.find((t) => t.accountId === "wen-li");
    expect(wen).toBeDefined();
    expect(wen!.links[0].ids.length).toBeGreaterThan(0);
    expect(guard(wen!.draft!.text).hits).toEqual([]);
    expect(ticketStatus(ds, next, wen!)).toBe("in-review");
    expect(currentReply(next, wen!)?.text).toContain("Hi Wen");
    expect(next.sent).toEqual({});
  });

  it("notes the stale deployment and the Lime rejection on the latest session", () => {
    const stale = runRules(ds, initialState(), only("stale"), at);
    expect(stale.activity.map((a) => a.accountId)).toEqual(["nadia-haddad"]);
    expect(stale.activity[0].text).toContain("5 trading days ago");
    const broker = runRules(ds, initialState(), only("broker-rejection"), at);
    expect(broker.activity.map((a) => a.accountId)).toEqual(["sofia-marchetti"]);
  });

  it("flags Harbor Lane momentum as ready for a live review, for a person to act on", () => {
    const ready = runRules(ds, initialState(), only("ready-for-live"), at);
    // Only Harbor Lane: Jonas Weber's breakout refused orders on 7 Oct, inside
    // the same 5-session window the CRM uses, so it isn't ready.
    expect(ready.lines.map((l) => l.deployment)).toEqual(["harbor-momentum"]);
    expect(ready.activity.every((a) => a.text.includes("A person decides"))).toBe(true);
  });

  it("is idempotent: a second run only skips", () => {
    const { next } = apply(initialState());
    const second = runRules(ds, next, all, at);
    expect(second.tickets).toEqual([]);
    expect(second.activity).toEqual([]);
    expect(second.lines.length).toBeGreaterThan(0);
    expect(second.lines.every((l) => l.skipped)).toBe(true);
    expect(second.lines.find((l) => l.rule === "refusal-streak")?.text).toMatch(/^Skipped: the streak since .+ already has ticket A-.+-streak-\d{4}-\d{2}-\d{2}\.$/);
  });

  it("runs nothing when every rule is off", () => {
    const off = Object.fromEntries(Object.keys(all).map((k) => [k, false])) as Record<RuleId, boolean>;
    expect(runRules(ds, initialState(), off, at)).toEqual({ tickets: [], activity: [], lines: [] });
  });

  it("keeps the run log newest first and capped", () => {
    let s = initialState();
    for (let i = 0; i < 25; i++) s = reducer(s, { type: "rules/run", run: { id: `r${i}`, at, by: "x", lines: [] }, tickets: [], activity: [] }, ds);
    expect(s.runs).toHaveLength(20);
    expect(s.runs[0].id).toBe("r24");
  });
});

// The ticket belongs to a streak (its first session), not to the deployment.
describe("refusal-streak tickets, one per streak", () => {
  const asOf = (date: string) => ({ ...ds, calendar: { ...ds.calendar, asOf: date } });
  const run = (data: typeof ds, state: State) => {
    const r = runRules(data, state, only("refusal-streak"), at);
    const next = reducer(state, { type: "rules/run", run: { id: "run", at, by: "Demo reviewer", lines: r.lines }, tickets: r.tickets, activity: r.activity }, data);
    return { r, next };
  };
  const line = (r: ReturnType<typeof runRules>, deployment: string) => r.lines.find((l) => l.deployment === deployment)!;

  it("keys the ticket to the first session of the unbroken run", () => {
    // Wen Li refused orders on 7, 8, 9 and 12 Oct, none before.
    const { r } = run(ds, initialState());
    expect(r.tickets.find((t) => t.accountId === "wen-li")?.id).toBe("A-wen-rebalance-streak-2026-10-07");
  });

  it("keeps a streak that continues on one ticket, and the skip names it", () => {
    const first = run(asOf("2026-10-09"), initialState());
    expect(line(first.r, "wen-rebalance").text).toMatch(/^Opened ticket A-wen-rebalance-streak-2026-10-07,/);
    const later = run(ds, first.next);
    expect(later.r.tickets.filter((t) => t.accountId === "wen-li")).toEqual([]);
    expect(line(later.r, "wen-rebalance")).toMatchObject({
      skipped: true,
      text: `Skipped: the streak since ${shortDate("2026-10-07")} already has ticket A-wen-rebalance-streak-2026-10-07.`,
    });
  });

  it("opens a new ticket for a new streak after a clean session, though the first was answered", () => {
    // Tomas: refusals 29 Sep to 1 Oct, a clean 2 Oct, refusals again from 5 Oct.
    const first = run(asOf("2026-10-01"), initialState());
    const old = first.r.tickets.find((t) => t.links[0].deployment === "tomas-meanrev")!;
    expect(old.id).toBe("A-tomas-meanrev-streak-2026-09-29");
    const answered = reducer(first.next, { type: "reply/approve", ticketId: old.id, by: "Demo reviewer", at }, ds);
    expect(ticketStatus(ds, answered, old)).toBe("replied");

    const later = run(asOf("2026-10-07"), answered);
    expect(later.r.tickets.map((t) => t.id)).toContain("A-tomas-meanrev-streak-2026-10-05");
    expect(line(later.r, "tomas-meanrev")).toMatchObject({ skipped: false });
  });

  it("opens nothing for a run shorter than three sessions", () => {
    // Tomas on 6 Oct: refusals on 5 and 6 Oct only, after the clean 2 Oct.
    const { r } = run(asOf("2026-10-06"), initialState());
    expect(r.lines.some((l) => l.deployment === "tomas-meanrev")).toBe(false);
  });
});
