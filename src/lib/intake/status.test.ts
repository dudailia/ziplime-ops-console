import { describe, expect, it } from "vitest";
import { STATIC_BASE as ds } from "../data/staticBase";
import { initialState, reducer } from "../store/state";
import { intakeStatus, waitingSignups } from "./status";
import { rulesTriage } from "./triage";

// The nav badge counts signups waiting for a person. It used to run the
// guard over every welcome email on every page to tell "review" from
// "flagged", though both count; waitingSignups needs only the decisions.
describe("waitingSignups", () => {
  const byStatus = (state: ReturnType<typeof initialState>) =>
    ds.signups.filter((s) => ["review", "flagged"].includes(intakeStatus(ds, state, s))).length;

  it("counts what intakeStatus calls review or flagged, on the seed", () => {
    expect(waitingSignups(ds, initialState())).toBe(byStatus(initialState()));
    expect(waitingSignups(ds, initialState())).toBe(30);
  });

  it("still matches after approvals and dismissals", () => {
    let state = initialState();
    const [a, b, c] = ds.signups;
    const { email } = rulesTriage(a);
    state = reducer(state, { type: "intake/approve", id: a.id, by: "t", at: "2026-10-15T12:00:00Z", email }, ds);
    state = reducer(state, { type: "intake/dismiss", id: b.id, by: "t", at: "2026-10-15T12:00:00Z" }, ds);
    state = reducer(state, { type: "intake/dismiss", id: c.id, by: "t", at: "2026-10-15T12:00:00Z" }, ds);
    expect(waitingSignups(ds, state)).toBe(byStatus(state));
    expect(waitingSignups(ds, state)).toBeLessThan(30);
  });
});
