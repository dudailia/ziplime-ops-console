import { aiClient, aiModel, aiOff, badRequest, textOf, upstreamError } from "@/lib/ai/server";
import { otherClients } from "@/lib/crm";
import { explain } from "@/lib/dryrun/explain";
import { readiness } from "@/lib/dryrun/metrics";
import { guard } from "@/lib/guard";
import { fileOf } from "@/lib/data/lookup";
import { getDataSource } from "@/lib/data/server";
import { linkedEvents } from "@/lib/inbox";

// Drafts a support reply. The prompt carries only this account's data: the
// thread, the linked lines (looked up here, server side, in this account's own
// files), their deterministic explanations, the risk profile and session counts.
// No other account is ever in the prompt. The draft still goes to review.

const SYSTEM = `You draft replies from the Limex support team to a trader using ziplime's Lime dry-run mode. A person at Limex reviews and approves every reply before it counts as sent.
In dry run, every order goes through lot rounding, the fail-closed ZIPLIME_* risk limits, the order deadline and Lime's validate_order, then is written to a JSON Lines file instead of being sent. Dry-run orders never fill.
You get the ticket thread and the facts from this trader's own dry-run file, including the console's built-in explanation of each linked line. Answer the trader's question from those facts.
Rules:
1. Never promise or suggest returns, profits or that a strategy will work. Don't use the word "guarantee".
2. Never give investment advice: nothing about what to buy, sell or hold, or where prices are going. Talk only about settings, the engine and the file.
3. Never mention other clients, customers or traders, by name or in general.
Also: under 180 words, plain sentences, no headings, no em dashes. Greet the trader by first name and sign "The Limex team". If a fact isn't in the data, say you'll check rather than guess. Under ZIPLIME_REQUIRE_ORDER_RISK_LIMITS=true the engine refuses to start with ZIPLIME_ALLOW_SELL=true; never suggest turning sells on under that profile.`;

type InMessage = { from?: unknown; author?: unknown; body?: unknown };
type Body = { ticket?: { accountId?: unknown; subject?: unknown; messages?: unknown; links?: unknown } };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return badRequest("Body must be JSON.");
  }
  const t = body.ticket;
  const ds = await (await getDataSource()).load();
  const account = ds.accounts.find((a) => a.id === t?.accountId);
  if (!t || !account) return badRequest("ticket.accountId must be a known account.");
  const messages = (Array.isArray(t.messages) ? (t.messages as InMessage[]) : [])
    .slice(-10)
    .filter((m) => typeof m.body === "string")
    .map((m) => ({ from: m.from === "limex" ? "limex" : "client", body: String(m.body).slice(0, 4000) }));
  const links = (Array.isArray(t.links) ? t.links : [])
    .filter((l): l is { deployment: string; ids: string[] } => typeof l?.deployment === "string" && Array.isArray(l?.ids))
    .map((l) => ({ deployment: l.deployment, ids: l.ids.filter((x: unknown): x is string => typeof x === "string").slice(0, 20) }));

  const client = aiClient();
  if (!client) return aiOff();

  const facts = linkedEvents(ds, { accountId: account.id, links }).map(({ deployment, profile, events }) => {
    const file = fileOf(ds, deployment.id);
    const sessions = new Set(events.map((e) => e.clock.session));
    return {
      strategy: deployment.strategy,
      risk_profile: deployment.riskEnv ?? "none (no ZIPLIME_* limits)",
      validate_orders: deployment.validateOrders,
      sessions_in_file: file.sessions.length,
      linked_sessions: file.sessions.filter((s) => sessions.has(s.date)).map((s) => ({ date: s.date, counts: s.counts })),
      linked_lines: events.map((e) => ({
        line: e.line,
        event: e.event,
        symbol: e.symbol,
        time_et: e.clock,
        ...(e.event === "refuse" || e.event === "skip"
          ? { reason: e.reason, requested_amount: e.requested_amount, explanation: explain(e, profile) }
          : e.event === "place"
            ? { side: e.side, quantity: e.quantity, order_type: e.order_type, broker_validated: e.broker_validated }
            : {}),
      })),
      readiness_checks: readiness(file, profile),
    };
  });

  try {
    const message = await client.messages.create({
      model: aiModel(),
      max_tokens: 900,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Trader first name: ${account.trader.split(" ")[0]}\nTicket subject: ${String(t.subject ?? "").slice(0, 200)}\nThread:\n${JSON.stringify(messages, null, 2)}\n\nFacts from this trader's dry-run file:\n${JSON.stringify(facts, null, 2)}\n\nDraft the reply.`,
        },
      ],
    });
    const text = textOf(message);
    const { hits } = guard(text, { otherClients: otherClients(account.id, ds.accounts) });
    return Response.json({ text, hits, model: message.model });
  } catch (exc) {
    return upstreamError(exc);
  }
}
