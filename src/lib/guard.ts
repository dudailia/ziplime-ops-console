// A phrase check on anything written to a client: support replies, welcome
// emails, Claude's explanations. It is not a compliance system, and the UI
// says so. A hit blocks Approve until the text is edited.

export type GuardCategory = "returns" | "advice" | "other-clients" | "pod-promise" | "ship-date";

export type GuardHit = {
  category: GuardCategory;
  label: string;
  match: string;
  index: number;
};

export type GuardOptions = {
  /** Identifiers of every account except the one being written to. */
  otherClients?: readonly string[];
  /** Welcome emails: also block Trading Pod promises and ship dates. */
  intake?: boolean;
};

export const CATEGORY_LABEL: Record<GuardCategory, string> = {
  returns: "Promises returns",
  advice: "Investment advice",
  "other-clients": "Mentions another client",
  "pod-promise": "Promises Trading Pod access",
  "ship-date": "Promises a ship date",
};

type Pattern = { category: GuardCategory; re: RegExp; label: string };

// Adverbs and hedges that sit between "you should" and the verb ("you should
// definitely buy"). Short and closed.
const HEDGE = "(?:(?:definitely|probably|really|seriously|certainly|just|also|still|maybe|perhaps|now|consider|think about|go ahead and|start)\\s+){0,3}";
// "add to", "trim" and "exit" are also everyday words ("exit the forwarder", "trim the
// allowlist"), so they count only with a holding after them. Tickers are matched
// case-sensitively in TICKER_ADVICE below, since every pattern here is /i.
const HOLDING = "(?:(?:your|the|this|that|a|some|those|these) )?(?:\\w+ )?(?:positions?|stakes?|holdings?|shares)\\b";
const TRADE_VERB = `(?:buy(?:ing)?|sell(?:ing)?|hold(?:ing)?(?! (?:off|on)\\b)|short(?:ing)?|dump(?:ing)?|load(?:ing)? up on|(?:add(?:ing)? to|trim(?:ming)?|exit(?:ing)?) ${HOLDING})`;
const ADVICE_LEAD = "\\byou(?:'d| would)? (?:should|ought to|need to|must|might want to|may want to|want to) ";
// Who a price move is about. Closed, so "your refusal rate will drop" never matches.
const MARKET_SUBJECT = "\\b(?:prices?|stocks?|shares|markets?|index|indices|equit(?:y|ies)|valuations?|crypto|bitcoin)";
const MOVE_VERB = "(?:go (?:up|down|higher|lower)|move (?:up|down|higher|lower)|head (?:up|down|higher|lower)|rise|fall|rally|drop|climb|surge|soar|crash|tank|rebound|recover|pop)";
const MOVE_PREDICTION = `(?:will (?:(?:likely|probably|definitely|surely|soon)\\s+)?${MOVE_VERB}|(?:is|are|looks?|seems?) (?:going|likely|expected|set|poised|about|due|ready) to ${MOVE_VERB})\\b`;
// "It will go up" is a prediction only when the sentence is about the market.
const PRONOUN_MOVE = `\\b(?:it|they)\\s+${MOVE_PREDICTION}(?=[^.!?\\n]*\\b(?:earnings|prices?|stocks?|shares|markets?|dividends?|guidance|the (?:open|close)|trading)\\b)`;
const PERCENT = "\\b\\d+(?:\\.\\d+)?\\s?%";

const BASE: Pattern[] = [
  { category: "returns", label: "guarantee", re: /\bguarantee(?:d|s)?\b/gi },
  { category: "returns", label: "risk-free", re: /\brisk[- ]free\b/gi },
  { category: "returns", label: "zero risk", re: /\bzero[- ]risk\b|\bno[- ]risk (?:setups?|strateg(?:y|ies)|trades?|investments?|returns?|profits?|plays?)\b/gi },
  { category: "returns", label: "can't lose", re: /\b(?:can(?:'|’)?t|cannot|won(?:'|’)?t) (?:lose|go wrong|miss)\b/gi },
  {
    category: "returns",
    label: "will make or earn",
    re: /(?:\b(?:will|should|could|can|would|going to)|'ll|’ll) (?:\w+ )?(?:make|earn|net) (?:you |them )?(?:money|a profit|profits?|returns?|gains?|a killing|\$\s?\d|\d+(?:\.\d+)?\s?%)|(?:\bwill|'ll|’ll) (?:\w+ )?profit\b/gi,
  },
  // "Sure thing, I'll look" and "an easy win: set X" are support talk, so no bare "sure thing" or "win".
  { category: "returns", label: "assured profit", re: /\b(?:assured|sure|certain|easy) (?:profits?|returns?|gains?|money)\b|\ba (?:sure|certain) (?:thing|bet)\b/gi },
  { category: "returns", label: "double your money", re: /\b(?:double|triple|grow|multiply) (?:your|their) (?:money|account|capital|investment)\b/gi },
  {
    category: "returns",
    label: "percent return",
    re: new RegExp(
      `${PERCENT}\\s+(?:annual\\s+|annualized\\s+|monthly\\s+|yearly\\s+)?(?:returns?|gains?|profits?|a (?:year|month|week)|per (?:year|month|week|annum)|each (?:year|month)|every (?:year|month)|annually|monthly|yearly)\\b|\\b(?:returns?|gains?|profits?|yield) of (?:up to |around |about |over )?\\d+(?:\\.\\d+)?\\s?%`,
      "gi",
    ),
  },
  { category: "returns", label: "outperform", re: /\boutperform(?:s|ed|ing)?\b/gi },
  { category: "returns", label: "beat the market", re: /\bbeat(?:s|ing)? the (?:market|index|S&P|SPY)\b/gi },
  { category: "advice", label: "you should buy/sell/hold", re: new RegExp(`${ADVICE_LEAD}${HEDGE}${TRADE_VERB}`, "gi") },
  {
    category: "advice",
    label: "I recommend buying/selling",
    re: new RegExp(
      `\\b(?:I|we)(?:'d|’d| would)? (?:(?:strongly|really|definitely)\\s+)?(?:recommend|suggest|advise|encourage)(?: (?:that )?you)?(?: to)? (?:consider(?:ing)? )?${TRADE_VERB}\\b`,
      "gi",
    ),
  },
  { category: "advice", label: "consider buying/selling", re: new RegExp(`\\bconsider ${TRADE_VERB}\\b`, "gi") },
  { category: "advice", label: "buy the dip", re: /\b(?:buy|sell|short) the (?:dip|rip|news|top|bottom)\b/gi },
  { category: "advice", label: "good investment", re: /\b(?:good|great|safe|smart|solid) (?:investment|buy|bet|entry)\b/gi },
  { category: "advice", label: "price target", re: /\bprice targets?\b/gi },
  {
    category: "advice",
    label: "will go up/down",
    re: new RegExp(
      `${MARKET_SUBJECT}\\s+${MOVE_PREDICTION}|${PRONOUN_MOVE}`,
      "gi",
    ),
  },
  { category: "advice", label: "now is a good time to", re: /\bnow is (?:a )?(?:good|great|the|the right|the perfect) time to\b/gi },
  { category: "advice", label: "buy/sell now", re: /\b(?:buy|sell) (?:it |them |more )?now\b/gi },
  { category: "other-clients", label: "other clients", re: /\bother (?:clients|customers|traders|users|accounts|investors|members)\b/gi },
  { category: "other-clients", label: "another client", re: /\banother (?:client|customer|trader|user|account|investor|member)\b/gi },
  {
    category: "other-clients",
    label: "our clients",
    re: /\b(?:(?:many|most|some|several|all|plenty|lots|a lot|a few|none) of )?our (?:other )?(?:clients|customers|traders|users|investors|members)\b/gi,
  },
];

// Case-sensitive: a ticker is capitals ("NVDA will rally", "you should trim TSLA").
// "I" is not a ticker ("I will drop the old file").
const TICKER = "\\b(?!I\\b)[A-Z]{1,5}\\b(?:'s|’s)?(?: (?:stock|shares|price))?";
const TICKER_ADVICE: Pattern[] = [
  { category: "advice", label: "will go up/down", re: new RegExp(`${TICKER}\\s+${MOVE_PREDICTION}`, "g") },
  {
    category: "advice",
    label: "you should buy/sell/hold",
    re: new RegExp(`\\b[Yy]ou(?:'d| would)? (?:should|ought to|need to|must|might want to|may want to|want to) ${HEDGE}(?:add(?:ing)? to|trim(?:ming)?|exit(?:ing)?) (?!I\\b)[A-Z]{1,5}\\b`, "g"),
  },
];

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

const INTAKE: Pattern[] = [
  {
    category: "pod-promise",
    label: "Trading Pod access",
    re: /\b(?:you(?:'ll|’ll| will| are|'re|’re)|we(?:'ll|’ll| will| can))\s+(?:\w+\s+){0,3}?(?:get|have|receive|join|be (?:added|invited|accepted|admitted)|add you|invite you|give you|let you (?:in|into))\s+(?:\w+\s+){0,3}?(?:the\s+)?Trading Pod\b/gi,
  },
  { category: "pod-promise", label: "welcome to Trading Pod", re: /\bwelcome to (?:the )?Trading Pod\b/gi },
  { category: "pod-promise", label: "accepted into Trading Pod", re: /\b(?:accepted|approved|admitted) (?:in|into|to|for) (?:the )?Trading Pod\b/gi },
  { category: "pod-promise", label: "Pod spot reserved", re: /\b(?:spot|seat|place) in (?:the )?Trading Pod\b/gi },
  {
    category: "ship-date",
    label: "date",
    re: new RegExp(`\\b(?:by|in|on|before|from|early|late|mid|next|this)[- ](?:${MONTH}|q[1-4]|week|month|quarter|spring|summer|fall|autumn|winter)\\b`, "gi"),
  },
  { category: "ship-date", label: "quarter", re: /\bQ[1-4](?:\s+20\d\d)?\b/g },
  { category: "ship-date", label: "calendar date", re: new RegExp(`\\b${MONTH}\\.? \\d{1,2}(?:st|nd|rd|th)?\\b`, "gi") },
  { category: "ship-date", label: "calendar date", re: /\b20\d\d-\d\d-\d\d\b/g },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function clientPatterns(terms: readonly string[]): Pattern[] {
  return [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 3))].map((term) => ({
    category: "other-clients" as const,
    label: term,
    // Masked ids contain "*", so plain \b doesn't bound them.
    re: new RegExp(`(?<![\\w*@.-])${escape(term)}(?![\\w*@-])`, "gi"),
  }));
}

export function guard(text: string, options: GuardOptions = {}): { ok: boolean; hits: GuardHit[] } {
  const patterns = [...BASE, ...TICKER_ADVICE, ...(options.intake ? INTAKE : []), ...clientPatterns(options.otherClients ?? [])];
  const hits: GuardHit[] = [];
  for (const p of patterns) {
    for (const m of text.matchAll(p.re)) {
      hits.push({ category: p.category, label: p.label, match: m[0], index: m.index ?? 0 });
    }
  }
  hits.sort((a, b) => a.index - b.index || b.match.length - a.match.length);
  // Overlapping hits merge into the first one, so each span is reported once.
  const kept: GuardHit[] = [];
  for (const h of hits) {
    const last = kept[kept.length - 1];
    const lastEnd = last ? last.index + last.match.length : -1;
    if (last && h.index < lastEnd) {
      const end = h.index + h.match.length;
      if (end > lastEnd) last.match = text.slice(last.index, end);
      continue;
    }
    kept.push({ ...h });
  }
  return { ok: kept.length === 0, hits: kept };
}

/** Splits text into plain and hit segments, for highlighting. */
export function segments(text: string, hits: readonly GuardHit[]): { text: string; hit: GuardHit | null }[] {
  const out: { text: string; hit: GuardHit | null }[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.index < at) continue;
    if (h.index > at) out.push({ text: text.slice(at, h.index), hit: null });
    out.push({ text: text.slice(h.index, h.index + h.match.length), hit: h });
    at = h.index + h.match.length;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: null });
  return out;
}
