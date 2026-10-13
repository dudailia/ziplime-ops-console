import { describe, expect, it } from "vitest";
import { otherClients } from "../crm";
import { guard } from "../guard";
import { SEED_ACCOUNTS } from "../seed";
import { allTickets, currentReply, initialState, needsReply, reducer, replyHits, type Action, type State } from "../store/state";
import { linkedEvents, replyStatus, SEED_TICKETS, templateReply } from ".";

const account = (id: string) => SEED_ACCOUNTS.find((a) => a.id === id)!;
const ticket = (id: string) => SEED_TICKETS.find((t) => t.id === id)!;
const run = (actions: Action[], from: State = initialState()) => actions.reduce(reducer, from);
const at = "2026-10-13T16:00:00-04:00";

describe("seed tickets", () => {
  it("has seven, each linked to orders that exist in that account's own files", () => {
    expect(SEED_TICKETS).toHaveLength(7);
    for (const t of SEED_TICKETS) {
      const found = linkedEvents(t).flatMap((l) => l.events);
      expect(found.length, t.id).toBe(t.links.flatMap((l) => l.ids).length);
    }
  });

  it("never resolves a link into another account's deployment", () => {
    expect(linkedEvents({ accountId: "wen-li", links: [{ deployment: "priya-growth", ids: ["4f55a0a8a90f963e5ee2"] }] })).toEqual([]);
  });
});

describe("template replies", () => {
  it.each(SEED_TICKETS.map((t) => [t.id, t] as const))("%s passes the guard and uses the file", (_id, t) => {
    const text = templateReply(t, account(t.accountId));
    expect(guard(text, { otherClients: otherClients(t.accountId, SEED_ACCOUNTS) }).hits).toEqual([]);
    expect(text).toMatch(/^Hi \S+,/);
    expect(text).toContain("The Limex team");
  });

  it("explains the unrecognised broker message without inventing one", () => {
    const text = templateReply(ticket("T-1044"), account("jonas-weber"));
    expect(text).toContain("price is outside the allowed band");
    expect(text).toContain("has no built-in explanation yet");
  });

  it("answers 'can we go live?' with the failing readiness check", () => {
    const text = templateReply(ticket("T-1045"), account("aaron-feld"));
    expect(text).toContain("validate_order");
    expect(text).toContain("A person at Limex reviews every switch to live");
  });
});

describe("reply review", () => {
  it("shows the seeded draft as flagged in all three categories", () => {
    const s = initialState();
    const t = ticket("T-1043");
    const reply = currentReply(s, t)!;
    const cats = new Set(replyHits(s, t, reply.text).map((h) => h.category));
    expect(cats).toEqual(new Set(["returns", "advice", "other-clients"]));
    expect(replyStatus(reply.text, 3)).toBe("flagged");
  });

  it("blocks Approve on a flagged draft", () => {
    const s = run([{ type: "reply/approve", ticketId: "T-1043", by: "Demo reviewer", at }]);
    expect(s.sent).toEqual({});
  });

  it("sends an approved clean draft once, then the ticket no longer needs a reply", () => {
    const t = ticket("T-1041");
    const text = templateReply(t, account("priya-raman"));
    const s = run([
      { type: "reply/set", ticketId: t.id, text, source: "template", by: "Demo reviewer", at },
      { type: "reply/approve", ticketId: t.id, by: "Demo reviewer", at },
      { type: "reply/approve", ticketId: t.id, by: "Demo reviewer", at },
    ]);
    expect(s.sent[t.id]).toHaveLength(1);
    expect(s.sent[t.id][0]).toMatchObject({ from: "limex", approvedBy: "Demo reviewer", source: "template" });
    expect(needsReply(s, t)).toBe(false);
    expect(currentReply(s, t)).toBeNull();
    expect(s.activity.map((a) => a.accountId)).toEqual(["priya-raman"]);
  });

  it("puts an edited draft back through the guard", () => {
    const t = ticket("T-1041");
    const s = run([
      { type: "reply/set", ticketId: t.id, text: "Hi Priya, all fine.", source: "template", by: "Demo reviewer", at },
      { type: "reply/set", ticketId: t.id, text: "Hi Priya, TSLA will go up anyway.", source: "human", by: "Demo reviewer", at },
      { type: "reply/approve", ticketId: t.id, by: "Demo reviewer", at },
    ]);
    expect(s.sent[t.id]).toBeUndefined();
  });

  it("doesn't duplicate a ticket an automation opens twice", () => {
    const created = { id: "A-wen-li-streak", accountId: "wen-li", subject: "x", createdAt: at, messages: [], links: [] };
    const s = run([
      { type: "tickets/create", tickets: [created], activity: [] },
      { type: "tickets/create", tickets: [created], activity: [] },
    ]);
    expect(allTickets(s).filter((t) => t.id === created.id)).toHaveLength(1);
  });
});
