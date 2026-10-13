import { describe, expect, it } from "vitest";
import { SIGNUPS } from "../intake";
import { rulesTriage } from "../intake/triage";
import { initialState, reducer, revive, type Action, type State } from "./state";

const run = (actions: Action[], from: State = initialState()) => actions.reduce(reducer, from);
const at = "2026-10-13T16:00:00-04:00";
const maya = SIGNUPS.find((s) => s.email === "maya.chen@example.com")!;
const approve = (id: string, body = rulesTriage(SIGNUPS.find((s) => s.id === id)!).email.body): Action => ({
  type: "intake/approve",
  id,
  by: "Demo reviewer",
  at,
  email: { subject: "Your Limex beta access", body },
});

describe("approving a Beta signup", () => {
  it("creates exactly one Beta account with no deployments, and logs it", () => {
    const s = run([approve(maya.id)]);
    expect(s.extraAccounts).toHaveLength(1);
    expect(s.extraAccounts[0]).toMatchObject({ trader: "Maya Chen", email: maya.email, plan: "beta", fromIntake: maya.id, accountNumber: "" });
    expect(s.intake[maya.id].decision).toMatchObject({ kind: "approved", accountId: s.extraAccounts[0].id });
    expect(s.activity).toHaveLength(1);
    expect(s.activity[0].text).toMatch(/^Approved from Beta intake by Demo reviewer/);
  });

  it("does nothing the second time", () => {
    const s = run([approve(maya.id), approve(maya.id)]);
    expect(s.extraAccounts).toHaveLength(1);
    expect(s.activity).toHaveLength(1);
  });

  it("refuses while the guard flags the email", () => {
    const s = run([approve(maya.id, "Welcome! You'll get access to Trading Pod next week.")]);
    expect(s.extraAccounts).toEqual([]);
    expect(s.intake[maya.id]).toBeUndefined();
  });

  it("refuses an email that names another client", () => {
    const s = run([approve(maya.id, "Hi Maya, Dana Okafor at Harbor Lane Capital uses this too.")]);
    expect(s.extraAccounts).toEqual([]);
  });

  it("can't approve a dismissed signup until it's reopened", () => {
    const dismissed = run([{ type: "intake/dismiss", id: maya.id, by: "Demo reviewer", at }, approve(maya.id)]);
    expect(dismissed.extraAccounts).toEqual([]);
    const reopened = run([{ type: "intake/reopen", id: maya.id }, approve(maya.id)], dismissed);
    expect(reopened.extraAccounts).toHaveLength(1);
  });

  it("keeps edits out once decided", () => {
    const s = run([approve(maya.id), { type: "intake/edit", id: maya.id, subject: "x", body: "changed" }]);
    expect(s.intake[maya.id].draft?.body).not.toBe("changed");
  });
});

describe("saved state", () => {
  it("revives what it saved and rejects anything else", () => {
    const s = run([approve(maya.id)]);
    expect(revive(JSON.stringify(s))).toEqual(s);
    expect(revive("{not json")).toBeNull();
    expect(revive(JSON.stringify({ v: 0 }))).toBeNull();
    expect(revive(null)).toBeNull();
  });

  it("resets to the seed", () => {
    expect(run([approve(maya.id), { type: "reset" }])).toEqual(initialState());
  });
});
