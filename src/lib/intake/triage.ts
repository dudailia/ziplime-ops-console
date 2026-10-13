// Rules triage for a Beta signup. Always runs, needs no key. Claude can refine
// type, assets, broker, workspace and the email; priority stays with these rules.

import { BROKERS, workspaceName, type Broker, type TraderType, type WorkspaceKey } from "./catalog";
import { skippedStepTwo, type Asset, type Signup } from "./types";

export type BrokerGuess = {
  /** A broker from the SnapTrade list, or another one the note names. */
  name: string | null;
  /** stated: the note names it. inferred: a guess from the answers. unknown: the form doesn't ask. */
  tag: "stated" | "inferred" | "unknown";
  onList: boolean;
  why: string;
};

export type Priority = { level: "high" | "normal" | "low"; reasons: string[] };

export type Triage = {
  source: "rules" | "claude";
  traderType: TraderType;
  traderTypeWhy: string;
  assets: Asset[];
  broker: BrokerGuess;
  workspace: WorkspaceKey;
  workspaceWhy: string;
  priority: Priority;
  email: { subject: string; body: string };
};

const NOTE_ASSETS: [Asset, RegExp][] = [
  ["Stocks", /\b(stocks?|equit(y|ies)|shares|etfs?|dividend|small caps?|index)\b/i],
  ["Options", /\b(options?|calls?|puts?|spreads?|0dte|iron condors?|theta|covered)\b/i],
  ["Futures", /\b(futures|ES|NQ|MES|MNQ|CL|perps?)\b/],
  ["Crypto", /\b(crypto|bitcoin|btc|eth(ereum)?|sol(ana)?|alts?|altcoins?)\b/i],
];

const BROKER_PATTERNS: [string, RegExp][] = [
  ["Robinhood", /\brobinhood\b/i],
  ["Charles Schwab", /\b(schwab|thinkorswim|tos)\b/i],
  ["Fidelity", /\bfidelity\b/i],
  ["E*TRADE", /\be\*?trade\b/i],
  ["Interactive Brokers", /\b(interactive brokers|ibkr|tws)\b/i],
  ["Coinbase", /\bcoinbase\b/i],
  ["Webull", /\bwebull\b/i],
  ["tastytrade", /\btasty(trade|works)\b/i],
];

const QUANT = /\b(python|backtest\w*|zipline|quant\w*|algo\w*|systematic|screeners?|code|pandas)\b/i;
const BEGINNER = /\b(new to|beginner|just started|learning|first (brokerage|robinhood|account)|do it properly)\b/i;

export function assetsOf(s: Signup): Asset[] {
  const set = new Set<Asset>(s.trade.filter((t): t is Asset => ["Stocks", "Options", "Futures", "Crypto"].includes(t)));
  if (s.note) for (const [asset, re] of NOTE_ASSETS) if (re.test(s.note)) set.add(asset);
  return (["Stocks", "Options", "Futures", "Crypto"] as const).filter((a) => set.has(a));
}

export function brokerOf(s: Signup, assets: Asset[]): BrokerGuess {
  if (s.note) {
    const found = BROKER_PATTERNS.map(([name, re]) => ({ name, at: s.note!.search(re) }))
      .filter((f) => f.at >= 0)
      .sort((a, b) => a.at - b.at)[0];
    if (found) {
      const onList = (BROKERS as readonly string[]).includes(found.name);
      return {
        name: found.name,
        tag: "stated",
        onList,
        why: onList
          ? `The note names ${found.name}.`
          : `The note names ${found.name}, which isn't one of the six brokers limex.com lists. It may be in the "+ 19 more via SnapTrade US".`,
      };
    }
  }
  if (assets.length === 1 && assets[0] === "Crypto") {
    return { name: "Coinbase" satisfies Broker, tag: "inferred", onList: true, why: "Crypto only, and Coinbase is the one crypto broker on the list. A guess." };
  }
  return { name: null, tag: "unknown", onList: false, why: "The form doesn't ask for a broker and nothing in the answers says." };
}

export function priorityOf(s: Signup): Priority {
  const reasons: string[] = [];
  if (s.wantsPod) reasons.push("Asked about Trading Pod");
  if (s.funded.includes("Trading one now")) reasons.push("Trading a funded account now");
  if (reasons.length) return { level: "high", reasons };
  if (skippedStepTwo(s) && !s.note) return { level: "low", reasons: ["Skipped the optional questions and left no note"] };
  return { level: "normal", reasons: ["Answered the questions; nothing that needs a fast reply"] };
}

function typeOf(s: Signup, assets: Asset[]): { type: TraderType; why: string } {
  const note = s.note ?? "";
  if (s.funded.includes("Trading one now")) return { type: "Prop / funded", why: 'Answered "Trading one now" to the funded question.' };
  if (QUANT.test(note)) return { type: "Quant / systematic", why: `The note mentions ${note.match(QUANT)![0]}.` };
  if (s.style.includes("Just starting") || BEGINNER.test(note)) {
    return { type: "Beginner", why: s.style.includes("Just starting") ? 'Picked "Just starting".' : "The note says they're new." };
  }
  if (assets.length === 1 && assets[0] === "Crypto") return { type: "Crypto trader", why: "Crypto is the only asset." };
  if (assets.includes("Options") && !assets.includes("Futures")) return { type: "Options trader", why: "Trades options." };
  if (assets.includes("Futures")) return { type: "Futures trader", why: "Trades futures." };
  if (s.style.includes("Day trading")) return { type: "Day trader", why: 'Picked "Day trading".' };
  if (s.style.includes("Swing")) return { type: "Swing trader", why: 'Picked "Swing".' };
  if (s.style.includes("Part-time")) return { type: "Part-time", why: 'Picked "Part-time".' };
  return { type: "Not enough to tell", why: "Only an email. The second step is optional and was skipped." };
}

function workspaceOf(type: TraderType, s: Signup): { key: WorkspaceKey; why: string } {
  switch (type) {
    case "Prop / funded":
      return { key: "prop", why: "Funded account." };
    case "Options trader":
      return { key: "options", why: "Options." };
    case "Crypto trader":
      return { key: "crypto", why: "Crypto only." };
    case "Day trader":
    case "Futures trader":
      return { key: "day", why: type === "Day trader" ? "Day trades." : "Futures, mostly intraday. No futures Workspace in the list." };
    case "Swing trader":
    case "Part-time":
      return { key: "swing", why: type === "Swing trader" ? "Swing trades." : "Part-time, so setups held for days fit better than intraday." };
    case "Quant / systematic":
      return s.style.includes("Day trading")
        ? { key: "day", why: "Systematic, intraday. No quant Workspace in the list." }
        : { key: "swing", why: "Systematic, holds for days or weeks. No quant Workspace in the list." };
    default:
      return { key: "getting-started", why: type === "Beginner" ? "New to trading." : "Nothing to go on yet." };
  }
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function welcomeEmail(s: Signup, t: Omit<Triage, "email" | "source">): { subject: string; body: string } {
  const lines: string[] = ["Hi,", "", "Thanks for signing up for the Limex beta."];
  if (skippedStepTwo(s) && !s.note) {
    lines.push(
      "",
      "If you have 30 seconds, reply and tell us what you trade and how. We read every answer, and it helps us set up your access.",
      "",
      `Until then we've started you in the ${workspaceName(t.workspace)} workspace. You can switch any time.`,
    );
  } else {
    const how = s.style.length ? ` (${list(s.style.map((x) => x.toLowerCase()))})` : "";
    lines.push(
      "",
      t.assets.length
        ? `You told us you trade ${list(t.assets.map((a) => a.toLowerCase()))}${how}. We've started you in the ${workspaceName(t.workspace)} workspace. You can switch any time.`
        : `We've started you in the ${workspaceName(t.workspace)} workspace. You can switch any time.`,
    );
    if (s.pain.includes("Manual entry")) {
      lines.push(
        "",
        t.broker.name && t.broker.onList
          ? `You mentioned manual entry. ${t.broker.name} is one of the brokers Limex connects to through SnapTrade, so you can link it rather than enter trades by hand.`
          : "You mentioned manual entry. Limex connects to brokers through SnapTrade, and limex.com lists the ones supported today.",
      );
    }
    if (s.pain.includes("Privacy")) {
      lines.push("", "You mentioned privacy. If you want to know what a broker connection shares before you link anything, reply and we'll answer.");
    }
  }
  if (s.wantsPod) {
    lines.push("", "You also asked about Trading Pod. It's invite-only and the team reviews track records separately, so this email isn't an invitation.");
  }
  lines.push("", "Beta access is free and needs no card. If anything doesn't work the way you expect, reply here. A person reads every reply.", "", "The Limex team");
  return { subject: "Your Limex beta access", body: lines.join("\n") };
}

export function rulesTriage(s: Signup): Triage {
  const assets = assetsOf(s);
  const { type, why } = typeOf(s, assets);
  const ws = workspaceOf(type, s);
  const base = {
    traderType: type,
    traderTypeWhy: why,
    assets,
    broker: brokerOf(s, assets),
    workspace: ws.key,
    workspaceWhy: ws.why,
    priority: priorityOf(s),
  };
  return { source: "rules", ...base, email: welcomeEmail(s, base) };
}
