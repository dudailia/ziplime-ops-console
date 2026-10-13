import { describe, expect, it } from "vitest";
import { summarizeAccount } from "./crm";
import { explain } from "./dryrun/explain";
import { guard } from "./guard";
import { SEED_TICKETS } from "./inbox";
import { signupById } from "./intake";
import { rulesTriage } from "./intake/triage";
import { runRules } from "./automations";
import { deploymentById, seedFile, SEED_ACCOUNTS } from "./seed";
import { initialState, replyHits } from "./store/state";
import { onStepPage, parseTour, TOUR, TOUR_IDLE, tourCta, tourReducer, type TourState } from "./tour";

const run = (...actions: Parameters<typeof tourReducer>[1][]) => actions.reduce(tourReducer, TOUR_IDLE);

describe("tour reducer", () => {
  it("has five steps with one sentence each", () => {
    expect(TOUR).toHaveLength(5);
    for (const s of TOUR) {
      expect(s.text.match(/[.!?](\s|$)/g), s.id).toHaveLength(1);
      expect(s.text.endsWith(".")).toBe(true);
    }
  });

  it("walks forward and back, and finishes after the last step", () => {
    expect(run({ type: "start" })).toEqual({ status: "running", step: 0 });
    expect(run({ type: "start" }, { type: "next" }, { type: "next" }, { type: "back" })).toEqual({ status: "running", step: 1 });
    expect(run({ type: "start" }, { type: "back" })).toEqual({ status: "running", step: 0 });
    const end = run({ type: "start" }, ...Array.from({ length: TOUR.length }, () => ({ type: "next" }) as const));
    expect(end).toEqual({ status: "done", step: TOUR.length - 1 });
  });

  it("skips to paused and resumes on the same step", () => {
    const paused = run({ type: "start" }, { type: "next" }, { type: "next" }, { type: "pause" });
    expect(paused).toEqual({ status: "paused", step: 2 });
    expect(tourReducer(paused, { type: "next" })).toBe(paused);
    expect(tourReducer(paused, { type: "resume" })).toEqual({ status: "running", step: 2 });
  });

  it("offers start, resume or again depending on the saved state", () => {
    expect(tourCta(TOUR_IDLE).label).toBe("Take the 3-minute tour");
    expect(tourCta({ status: "paused", step: 2 })).toEqual({ label: "Resume the tour, step 3 of 5", action: { type: "resume" } });
    expect(tourCta({ status: "done", step: 4 }).label).toBe("Take the tour again");
  });

  it("restores a saved tour defensively, and a reload mid-tour comes back paused", () => {
    expect(parseTour(null)).toEqual(TOUR_IDLE);
    expect(parseTour("{not json")).toEqual(TOUR_IDLE);
    expect(parseTour(JSON.stringify({ status: "flying", step: 1 }))).toEqual(TOUR_IDLE);
    expect(parseTour(JSON.stringify({ status: "paused", step: 1.5 }))).toEqual(TOUR_IDLE);
    expect(parseTour(JSON.stringify({ status: "paused", step: 99 }))).toEqual({ status: "paused", step: 4 });
    expect(parseTour(JSON.stringify({ status: "running", step: 3 } satisfies TourState))).toEqual({ status: "paused", step: 3 });
  });

  it("knows when the visitor is on the step's page", () => {
    const step = TOUR[0];
    expect(onStepPage(step, "/portal", new URLSearchParams("d=priya-growth&s=2026-10-12&l=50"))).toBe(true);
    expect(onStepPage(step, "/portal", new URLSearchParams("d=wen-rebalance"))).toBe(false);
    expect(onStepPage(TOUR[1], "/ops", new URLSearchParams("q=x"))).toBe(true);
    expect(onStepPage(TOUR[1], "/ops/inbox", new URLSearchParams())).toBe(false);
  });
});

// Every sentence in the tour makes a claim about the seed. These keep them true.
describe("tour sentences match the seed", () => {
  it("step 1: line 50 is Priya's 11:09 TSLA allowlist refusal on 12 Oct", () => {
    const d = deploymentById("priya-growth")!;
    const e = seedFile(d.id).events.find((x) => x.line === 50)!;
    expect(e).toMatchObject({ event: "refuse", symbol: "TSLA" });
    expect(e.clock.session).toBe("2026-10-12");
    expect(e.event === "refuse" && explain(e, { riskEnv: d.riskEnv, validateOrders: d.validateOrders })?.ruleId).toBe("allowlist");
  });

  it("step 2: Jonas Weber is on watch for 11% refused over 5 sessions", () => {
    const s = summarizeAccount(SEED_ACCOUNTS.find((a) => a.id === "jonas-weber")!);
    expect(s.health.level).toBe("amber");
    expect(s.health.reasons[0].text).toMatch(/^11% of orders refused over the last 5 sessions/);
  });

  it("step 3: T-1043's seeded draft trips returns, advice and other clients", () => {
    const t = SEED_TICKETS.find((x) => x.id === "T-1043")!;
    const cats = new Set(replyHits(initialState(), t, t.draft!.text).map((h) => h.category));
    expect([...cats].sort()).toEqual(["advice", "other-clients", "returns"]);
    expect(guard(t.draft!.text).ok).toBe(false);
  });

  it("step 4: will.tanaka is high priority for a funded account and Trading Pod", () => {
    const t = rulesTriage(signupById("su-023")!);
    expect(t.priority.level).toBe("high");
    expect(t.priority.reasons.join(" ")).toMatch(/Trading Pod/);
    expect(t.priority.reasons.join(" ")).toMatch(/funded/);
  });

  it("step 5: a run opens streak tickets, notes a Lime rejection and flags Harbor Lane", () => {
    const r = runRules(initialState(), { "refusal-streak": true, "broker-rejection": true, stale: true, "ready-for-live": true }, "2026-10-13T16:30:00-04:00");
    expect(r.tickets.length).toBeGreaterThan(0);
    expect(r.lines.some((l) => l.rule === "broker-rejection")).toBe(true);
    expect(r.lines.filter((l) => l.rule === "ready-for-live").map((l) => l.deployment)).toEqual(["harbor-momentum"]);
  });
});
