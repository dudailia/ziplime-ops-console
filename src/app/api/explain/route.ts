import { aiClient, aiModel, aiOff, badRequest, textOf, upstreamError } from "@/lib/ai/server";
import { guard } from "@/lib/guard";
import { readJson } from "@/lib/http/body";

// Explains one refusal reason that matched no built-in rule. The request
// carries only that reason, its event and the deployment's risk profile.

const SYSTEM = `You explain refusals from ziplime's Lime dry-run mode to the trader who ran the strategy.
ziplime is an open-source backtesting and live-trading engine. In dry run, every order still goes through lot rounding, the fail-closed risk limits (ZIPLIME_* env vars), the order deadline and Lime's validate_order call; then it is written to a JSON Lines file instead of being sent.
You get one reason string the console has no built-in rule for. Say in plain words what most likely happened, which check or setting it points to, and what the trader could check or change.
Rules:
- 90 words or fewer. Plain sentences. No headings, no lists, no em dashes.
- If the message comes from Lime's validate_order, say it is Lime's own check and that the console can't see Lime's rule behind it.
- Say what you are unsure about. Don't invent settings, numbers or Lime rules.
- Never give investment advice, never say whether to buy, sell or hold, never talk about returns.`;

type Body = { reason?: unknown; event?: unknown; symbol?: unknown; requestedAmount?: unknown; riskEnv?: unknown; validateOrders?: unknown };

export async function POST(request: Request) {
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const body = (read.value ?? {}) as Body;
  if (typeof body.reason !== "string" || body.reason.length === 0 || body.reason.length > 1000) {
    return badRequest("reason must be a string of 1 to 1000 characters.");
  }
  const client = aiClient();
  if (!client) return aiOff();

  const riskEnv =
    body.riskEnv && typeof body.riskEnv === "object"
      ? Object.fromEntries(
          Object.entries(body.riskEnv as Record<string, unknown>)
            .filter(([k, v]) => /^ZIPLIME_[A-Z_]+$/.test(k) && typeof v === "string")
            .slice(0, 12),
        )
      : null;
  const facts = {
    event: body.event === "skip" ? "skip" : "refuse",
    reason: body.reason,
    symbol: typeof body.symbol === "string" ? body.symbol.slice(0, 12) : null,
    requested_amount: typeof body.requestedAmount === "number" ? body.requestedAmount : null,
    risk_profile: riskEnv,
    validate_orders: typeof body.validateOrders === "boolean" ? body.validateOrders : null,
  };

  try {
    const message = await client.messages.create({
      model: aiModel(),
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: "user", content: `Explain this dry-run line:\n${JSON.stringify(facts, null, 2)}` }],
    });
    const text = textOf(message);
    return Response.json({ text, hits: guard(text).hits, model: message.model });
  } catch (exc) {
    return upstreamError(exc);
  }
}
