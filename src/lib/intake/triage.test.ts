import { describe, expect, it } from "vitest";
import signupsJson from "../../../data/seed/signups.json";
import { guard } from "../guard";
import { brokerOf, priorityOf, rulesTriage } from "./triage";
import type { Signup } from "./types";

const SIGNUPS = signupsJson.signups as Signup[];
const byEmail = (e: string) => SIGNUPS.find((s) => s.email === e)!;
const blank: Signup = { id: "x", email: "x@example.com", ts: "2026-10-01T09:00:00-04:00", page: "/", trade: [], style: [], funded: [], pain: [], wantsPod: false };

describe("seed signups", () => {
  it("has 30, with fictional emails, some of them email-only", () => {
    expect(SIGNUPS).toHaveLength(30);
    expect(SIGNUPS.every((s) => /@example\.(com|net|org)$/.test(s.email))).toBe(true);
    expect(SIGNUPS.filter((s) => s.trade.length === 0 && !s.note).length).toBeGreaterThanOrEqual(3);
  });

  it("only uses the options the real form offers", () => {
    const allowed = {
      trade: ["Stocks", "Options", "Futures", "Crypto"],
      style: ["Day trading", "Swing", "Part-time", "Just starting"],
      funded: ["Trading one now", "Working toward it", "Not my thing"],
      pain: ["Manual entry", "No real insight", "My own psychology", "Price", "Privacy", "Other"],
    };
    for (const s of SIGNUPS) for (const key of ["trade", "style", "funded", "pain"] as const) for (const v of s[key]) expect(allowed[key]).toContain(v);
  });

  it("drafts a welcome email for every signup that passes the intake guard", () => {
    for (const s of SIGNUPS) {
      const { hits } = guard(rulesTriage(s).email.body, { intake: true });
      expect(hits, s.email).toEqual([]);
    }
  });
});

describe("rules triage per persona", () => {
  it.each([
    ["maya.chen@example.com", "Beginner", "getting-started", ["Stocks"]],
    ["d.okonkwo@example.net", "Options trader", "options", ["Options"]],
    ["raj.patel.trades@example.com", "Prop / funded", "prop", ["Futures"]],
    ["sam.whitaker@example.com", "Crypto trader", "crypto", ["Crypto"]],
    ["tom.becker@example.net", "Quant / systematic", "swing", ["Stocks"]],
    ["kwame.boateng@example.net", "Day trader", "day", ["Stocks"]],
    ["diego.santos@example.com", "Futures trader", "day", ["Futures"]],
    ["priyanka.s@example.com", "Swing trader", "swing", ["Stocks"]],
    ["lena.vogt@example.org", "Not enough to tell", "getting-started", []],
  ])("%s -> %s", (email, type, workspace, assets) => {
    const t = rulesTriage(byEmail(email));
    expect(t.traderType).toBe(type);
    expect(t.workspace).toBe(workspace);
    expect(t.assets).toEqual(assets);
  });

  it("asks an email-only signup to tell us more", () => {
    expect(rulesTriage(byEmail("lena.vogt@example.org")).email.body).toContain("reply and tell us what you trade");
  });

  it("never promises Trading Pod to someone who asked about it", () => {
    const body = rulesTriage(byEmail("will.tanaka@example.com")).email.body;
    expect(body).toContain("this email isn't an invitation");
  });
});

describe("broker tags", () => {
  it("is stated when the note names one, even if crypto-only would infer Coinbase", () => {
    const s = { ...blank, trade: ["Crypto"], note: "I keep everything on Robinhood." };
    expect(brokerOf(s, ["Crypto"])).toMatchObject({ name: "Robinhood", tag: "stated", onList: true });
  });

  it("reads thinkorswim as Schwab and IBKR as Interactive Brokers", () => {
    expect(rulesTriage(byEmail("d.okonkwo@example.net")).broker).toMatchObject({ name: "Charles Schwab", tag: "stated" });
    expect(rulesTriage(byEmail("tom.becker@example.net")).broker).toMatchObject({ name: "Interactive Brokers", tag: "stated" });
  });

  it("names a broker off the list without pretending it's on it", () => {
    expect(rulesTriage(byEmail("sofia.reyes@example.com")).broker).toMatchObject({ name: "Webull", tag: "stated", onList: false });
  });

  it("infers Coinbase only for crypto-only signups, and says it's a guess", () => {
    const b = rulesTriage(byEmail("amira.haddou@example.org")).broker;
    expect(b).toMatchObject({ name: "Coinbase", tag: "inferred" });
    expect(b.why).toMatch(/guess/);
  });

  it("is unknown when nothing says", () => {
    expect(brokerOf({ ...blank, trade: ["Stocks"] }, ["Stocks"])).toMatchObject({ name: null, tag: "unknown" });
    expect(SIGNUPS.filter((s) => rulesTriage(s).broker.tag === "unknown").length).toBeGreaterThan(10);
  });
});

describe("priority boundaries", () => {
  it("is high for Trading Pod interest or a funded account trading now", () => {
    expect(priorityOf({ ...blank, wantsPod: true }).level).toBe("high");
    expect(priorityOf({ ...blank, funded: ["Trading one now"] }).level).toBe("high");
    expect(priorityOf({ ...blank, funded: ["Working toward it"] }).level).toBe("normal");
  });

  it("is low only when step 2 was skipped and there's no note", () => {
    expect(priorityOf(blank).level).toBe("low");
    expect(priorityOf({ ...blank, note: "hi" }).level).toBe("normal");
    expect(priorityOf({ ...blank, pain: ["Price"] }).level).toBe("normal");
  });
});
