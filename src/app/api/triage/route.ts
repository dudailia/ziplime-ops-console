import { aiClient, aiModel, aiOff, aiRequestRefused, badRequest, textOf, upstreamError } from "@/lib/ai/server";
import { guard } from "@/lib/guard";
import { getDataSource } from "@/lib/data/server";
import { readJson } from "@/lib/http/body";
import { signupById } from "@/lib/intake";
import { BROKERS, TRADER_TYPES, WORKSPACES, type TraderType, type WorkspaceKey } from "@/lib/intake/catalog";
import { rulesTriage, type Triage } from "@/lib/intake/triage";
import type { Asset } from "@/lib/intake/types";

// Refines one signup's triage. The request names a seeded signup by id; only
// that signup's answers and its rules triage go to Claude. Priority is never
// Claude's call: the rules value is kept.

const ASSETS = ["Stocks", "Options", "Futures", "Crypto"] as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["traderType", "traderTypeWhy", "assets", "brokerName", "brokerTag", "brokerWhy", "workspace", "workspaceWhy", "emailSubject", "emailBody"],
  properties: {
    traderType: { type: "string", enum: [...TRADER_TYPES] },
    traderTypeWhy: { type: "string" },
    assets: { type: "array", items: { type: "string", enum: [...ASSETS] } },
    brokerName: { type: "string", description: "A broker the signup names or a guess; empty string if unknown." },
    brokerTag: { type: "string", enum: ["stated", "inferred", "unknown"] },
    brokerWhy: { type: "string" },
    workspace: { type: "string", enum: WORKSPACES.map((w) => w.key) },
    workspaceWhy: { type: "string" },
    emailSubject: { type: "string" },
    emailBody: { type: "string" },
  },
} as const;

const SYSTEM = `You help a person at Limex triage signups for the Limex US beta. limex.com's form says "We read every single answer", and a person approves every triage you write.
You get one signup: the answers to limex.com's optional questions, a Trading Pod interest toggle, an optional free-text note, and the console's rules-based triage. Refine the rules triage where the note shows something the rules missed. Keep a rules value when you have nothing better.

Facts you may use, and nothing beyond them:
- Beta access is free and needs no card.
- Limex connects to brokers through SnapTrade. The listed brokers are ${BROKERS.join(", ")}, plus 19 more via SnapTrade US.
- Workspaces (placeholder names): ${WORKSPACES.map((w) => `${w.key} = ${w.name}`).join("; ")}.
- Trading Pod is invite-only, and the team reviews track records separately.
- A person reads every reply.

Broker: "stated" only if the note names the broker. "inferred" only for a real clue, and brokerWhy must say it is a guess. Otherwise "unknown" with an empty brokerName. The form never asks for a broker.

Welcome email, 120 words or fewer, plain sentences, no em dashes, signed "The Limex team". Never:
- give investment advice or say what to buy, sell or hold,
- promise or suggest returns, profits or passing a prop challenge (don't use the word "guarantee" at all),
- promise Trading Pod access, a spot, or an invitation,
- give any date or timeframe for features or access,
- mention other customers or traders,
- describe Limex features beyond the facts above.`;

type Out = {
  traderType: TraderType;
  traderTypeWhy: string;
  assets: Asset[];
  brokerName: string;
  brokerTag: "stated" | "inferred" | "unknown";
  brokerWhy: string;
  workspace: WorkspaceKey;
  workspaceWhy: string;
  emailSubject: string;
  emailBody: string;
};

function valid(o: Partial<Out>): o is Out {
  return (
    typeof o === "object" &&
    o !== null &&
    (TRADER_TYPES as readonly string[]).includes(o.traderType ?? "") &&
    Array.isArray(o.assets) &&
    o.assets.every((a) => (ASSETS as readonly string[]).includes(a)) &&
    typeof o.brokerName === "string" &&
    ["stated", "inferred", "unknown"].includes(o.brokerTag ?? "") &&
    WORKSPACES.some((w) => w.key === o.workspace) &&
    typeof o.emailSubject === "string" &&
    typeof o.emailBody === "string" &&
    o.emailBody.length > 0
  );
}

export async function POST(request: Request) {
  const refused = aiRequestRefused(request);
  if (refused) return refused;
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const id = (read.value as { id?: unknown } | null)?.id;
  const ds = await (await getDataSource()).load();
  const signup = typeof id === "string" ? signupById(ds.signups, id) : undefined;
  if (!signup) return badRequest("Unknown signup id.");
  const client = aiClient();
  if (!client) return aiOff();

  const rules = rulesTriage(signup);
  const { id: _id, email, ...answers } = signup;
  void _id;
  const input = {
    email_domain: email.split("@")[1],
    answers,
    rules_triage: { ...rules, email: undefined, source: undefined },
    rules_email: rules.email,
  };

  try {
    const message = await client.messages.create({
      model: aiModel(),
      max_tokens: 1500,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: `Triage this signup:\n${JSON.stringify(input, null, 2)}` }],
    });
    let out: Partial<Out>;
    try {
      out = JSON.parse(textOf(message)) as Partial<Out>;
    } catch {
      return Response.json({ error: "Claude's answer wasn't valid JSON." }, { status: 502 });
    }
    if (!valid(out)) return Response.json({ error: "Claude's answer didn't match the triage schema." }, { status: 502 });

    const name = out.brokerTag === "unknown" ? null : out.brokerName.trim() || null;
    const triage: Triage = {
      source: "claude",
      traderType: out.traderType,
      traderTypeWhy: out.traderTypeWhy,
      assets: ASSETS.filter((a) => out.assets.includes(a)),
      broker: {
        name,
        tag: name ? out.brokerTag : "unknown",
        onList: name !== null && (BROKERS as readonly string[]).includes(name),
        why: out.brokerWhy,
      },
      workspace: out.workspace,
      workspaceWhy: out.workspaceWhy,
      priority: rules.priority,
      email: { subject: out.emailSubject, body: out.emailBody },
    };
    const others = ds.signups.filter((s) => s.id !== signup.id).map((s) => s.email);
    const { hits } = guard(`${triage.email.subject}\n${triage.email.body}`, { intake: true, otherClients: others });
    return Response.json({ triage, hits, model: message.model });
  } catch (exc) {
    return upstreamError(exc);
  }
}
