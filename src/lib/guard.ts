// A phrase check on anything written to a client: support replies, welcome
// emails, Claude's explanations. It is not a compliance system, and the UI
// says so. A hit blocks Approve until the text is edited.

import { normalize } from "./guard.normalize";

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
const HEDGE = "(?:(?:definitely|definately|defo|probably|really|seriously|certainly|just|also|still|maybe|perhaps|now|consider|think about|go ahead and|start)\\s+){0,3}";
// "add to", "trim" and "exit" are also everyday words ("exit the forwarder", "trim the
// allowlist"), so they count only with a holding after them. Tickers are matched
// case-sensitively in TICKER_ADVICE below, since every pattern here is /i.
const HOLDING = "(?:(?:your|the|this|that|a|some|those|these) )?(?:\\w+ )?(?:positions?|stakes?|holdings?|shares)\\b";
const TRADE_VERB = `(?:buy(?:ing)?|sell(?:ing)?|hold(?:ing)?(?! (?:off|on)\\b)|short(?:ing)?|dump(?:ing)?|load(?:ing)? up on|invest(?:ing)? (?:more|in)\\b|(?:over|under)weight|accumulat(?:e|ing)|(?:add(?:ing)? to|trim(?:ming)?|exit(?:ing)?) ${HOLDING})`;
// "should" with the usual typos (shuold, shoud), and "you" as "yu".
const SHOULD = "(?:should|shuold|shoud|shud|ought to|need to|must|might want to|may want to|want to)";
const ADVICE_LEAD = `\\by(?:o)?u(?:'d| would)? (?:(?:really|honestly|seriously|definitely|probably)\\s+)?${SHOULD} `;
// Who a price move is about. Closed, so "your refusal rate will drop" never matches.
const MARKET_SUBJECT = "\\b(?:prices?|stocks?|shares|markets?|index|indices|equit(?:y|ies)|valuations?|crypto|bitcoin|oil|gold|silver|bonds|the s&p(?: 500)?|nasdaq|the dow)";
const MOVE_VERB =
  "(?:go (?:up|down|higher|lower)|move (?:up|down|higher|lower)|head (?:up|down|higher|lower)|rise|fall|rally|drop|climb|surge|soar|crash|tank|rebound|recover|pop|bounce|spike|explode(?: higher)?|take off|rip(?: higher)?|double|triple|skyrocket|plunge|plummet|collapse)";
const MOVE_ADVERB = "(?:(?:likely|probably|definitely|surely|soon|easily|really|certainly|only)\\s+)?";
const MOVE_PREDICTION = `(?:(?:will|'ll|’ll|should|could|might|may|can) ${MOVE_ADVERB}${MOVE_VERB}|(?:is|are|'s|’s|looks?|seems?) (?:going|likely|expected|set|poised|about|due|ready) to ${MOVE_VERB}|(?:is|are|'s|’s) (?:headed|heading|going) (?:to the moon|to \\$?\\d|for (?:a )?(?:correction|crash|fall|drop|rally)|higher|lower))\\b`;
// "It will go up" is a prediction only when the sentence is about the market.
const PRONOUN_MOVE = `\\b(?:it|they)\\s+${MOVE_PREDICTION}(?=[^.!?\\n]*\\b(?:earnings|prices?|stocks?|shares|markets?|dividends?|guidance|the (?:open|close)|trading)\\b)`;
const PERCENT = "\\b\\d+(?:\\.\\d+)?\\s?%";

const SENTENCE_START = "(?:^|[.!?;:]\\s+|\\n\\s*)(?:(?:just|so|then|now|honestly|definitely|do|go ahead and|please)[,\\s]+)?";
const NOT_AN_ORDER = "(?!\\s+(?:orders?|side|signals?|lines?|events?|limits?)\\b)";

const TUNED: Pattern[] = [
  // Advice as an order: "Ditch Intel", "Sell your bonds", "Go long on oil".
  {
    category: "advice",
    label: "trade order",
    re: new RegExp(
      `${SENTENCE_START}(?:(?:buy|sell|short)${NOT_AN_ORDER}|dump|ditch|unload|accumulate|bail on|exit ${HOLDING}|close out|invest (?:in|the|more|your|it)|swap (?:your|the)|switch (?:from|out of|into)|hold on to (?:your|those|these|the)|rebalance into|scale (?:in|into|out)|jump on|move your money|(?:over|under)weight)\\b`,
      "gi",
    ),
  },
  {
    category: "advice",
    label: "trade order",
    re: /\b(?:load the boat|back up the truck|average down|double down|cut your losses|go (?:long|short)(?: on)?|pile into|snap up|stay invested|ride (?:it|this) out|keep (?:buying|selling|adding)|follow the trend|lock in (?:your )?(?:gains|profits)|get defensive|(?:open|start|build|initiate)(?:ing)? a (?:small |new |starter )?position|(?:over|under)weight)\b/gi,
  },
  { category: "advice", label: "buy more", re: /\b(?:buy(?:ing)?|grab(?:bing)?|pick(?:ing)? up|snap(?:ping)? up|accumulat(?:e|ing)|load(?:ing)? up on|pil(?:e|ing) into)\s+(?:some|a few|more)\b(?!\s+than)/gi },
  { category: "advice", label: "buy more", re: new RegExp(`\\band (?:buy|sell)(?=\\s+(?:more|some|it|them|now|stocks|shares|everything|half)\\b|\\s*[.!])|\\b(?:so|just|then)\\s+(?:buy|sell)\\b${NOT_AN_ORDER}|\\b(?:buy|sell) instead\\b|\\bdon(?:'|’)?t (?:sell|buy)\\b${NOT_AN_ORDER}`, "gi") },
  {
    category: "advice",
    label: "soft advice",
    re: /\byou(?:'d|’d| would) (?:be wise|do well|be smart|be mad not|be crazy not) to\b|\b(?:your|the) best (?:move|bet|play) (?:is|would be) to\b|\bmy advice\b|\b(?:top|our|my) picks?\b|\ba (?:bargain|steal|no-brainer|screaming buy)\b|\bmust-(?:buy|own|have)\b|\bworth (?:buying|selling|owning)\b|\b(?:under|over)valued\b|\b(?:bullish|bearish) on\b|\bsteer clear of\b|\bsmart money is\b|\beveryone should (?:own|buy|hold)\b|\bshould be (?:buying|selling|investing|holding|shorting)\b/gi,
  },
  {
    category: "advice",
    label: "now is the time",
    re: /\b(?:excellent|perfect|great|good|best|right|ideal) (?:time|moment) to (?:buy|sell|invest|get in|get into|start a position|add|load up)|\bmoment to (?:get into|buy|sell)\b|\bit(?:'s|’s| is) time to (?:buy|sell|invest|get in|get out|take profits)\b|\bentry point\b|\bbefore it(?:'s|’s| is) too late\b|\bwhile (?:it(?:'s|’s| is)(?: still)?|the stock is|they(?:'re|’re| are)|prices are) (?:cheap|low|weak|down|on sale)\b|\bwhile you still can\b/gi,
  },
  { category: "advice", label: "consider buying/selling", re: /\b(?:thought about|thinking about|considered|considering) (?:picking up|buying|selling|shorting|adding to|trimming|dumping)\b|\btake (?:the |some )?profits?\b|\bchips off the table\b/gi },
  { category: "advice", label: "I recommend buying/selling", re: /\b(?:I|we) (?:favou?r|prefer) (?:buying|selling|shorting)\b|\b(?:I|we)(?:'d|’d| would) (?:\w+ )?(?:buy|sell|short|add to|load up|pick up|trim|dump|put (?:more )?money)\b/gi },
  {
    category: "advice",
    label: "recommended",
    re: /\b(?:buying|selling|shorting|holding)\b[^.!?\n]{0,30}?\b(?:is|are) (?:\w+ )?(?:advised|recommended|suggested)\b|\bis recommended as a (?:buy|sell)\b/gi,
  },
  {
    category: "advice",
    label: "move your money",
    re: /\bput (?:your |more |spare |the rest of your )?(?:money|cash|savings|spare cash) into\b|\bget (?:out of|into|in on) (?:the market|stocks|equities|crypto|bitcoin|gold|\w+ stocks)\b|\bget (?:in|out) (?:while|now|before|early)\b|\binvest(?:ing)? (?:the rest|more|everything)\b/gi,
  },
  { category: "advice", label: "will go up/down", re: new RegExp(`\\bexpect (?:the )?${MARKET_SUBJECT.slice(2)} to ${MOVE_VERB}\\b|\\bcan only go up\\b|\\bto the moon\\b`, "gi") },
  // Promised outcomes.
  { category: "returns", label: "assured profit", re: /\b(?:profits?|gains?|returns?|money|success)\s+(?:is|are)\s+(?:\w+\s+)?(?:assured|certain|locked in|safe|protected)\b|\b(?:certain|bound|sure) to (?:grow|rise|make|profit|gain|double)\b|\bstand to (?:make|gain|profit)\b/gi },
  {
    category: "returns",
    label: "can't lose",
    re: /\b(?:prints?|free|easy|passive) (?:money|income)\b|\b(?:surefire|foolproof|can(?:'|’)?t-miss)\b|\bcan(?:'|’)?t fail\b(?! open)|\bcannot fail\b(?! open)|\bnever (?:loses?|lost|has a losing)\b|\balways makes? money\b|\bmakes? money in any market\b|\bno way (?:you|to) lose\b|\bprotected from (?:any )?loss(?:es)?\b|\b(?:every|each) trade (?:is a winner|wins|makes money)\b/gi,
  },
  { category: "returns", label: "no downside", re: /\b(?:no|zero) downside\b|\bdownside is limited\b|\blimited downside\b|\b(?:plenty of|lots of|\d+%) upside\b|\bupside (?:left|potential)\b|\ball upside\b/gi },
  {
    category: "returns",
    label: "big returns",
    re: /\bpays? off (?:big|handsomely|nicely)\b|\bpays? for itself\b|\bturn \$[\d,.]+ into \$[\d,.]+|\b(?:huge|massive|big|double-digit|higher|consistent|steady) (?:returns?|gains?|profits?)\b|\b(?:returns?|gains?|profits?) will be (?:higher|bigger|better|huge|great)\b|\bexpect (?:to make|a profit|consistent|profits?|gains?)\b|\bhappy with the returns\b|\bmake you (?:rich|a millionaire|a fortune)\b|\bin profit by\b/gi,
  },
  {
    category: "returns",
    label: "will make or earn",
    re: /\byou(?:'ll|’ll| will| are going to|'re going to|’re going to)\s+(?:\w+\s+)?(?:be (?:up|in profit|rich|a millionaire)\b|see (?:\w+[- ])?(?:returns?|gains?|profits?)\b|beat (?:inflation|the market)\b|recoup\b|make (?:your money back|a lot|a fortune|a killing)\b|be rewarded\b|not lose\b|never lose\b)/gi,
  },
  // Other clients, by description rather than by name.
  {
    category: "other-clients",
    label: "other clients",
    re: /\b(?:someone|somebody|everyone|everybody) else\b|\bfellow (?:clients?|customers?|traders?|users?|investors?|members?)\b|\b(?:clients?|customers?|traders?|users?|investors?|members?|people) (?:like|similar to) you(?:rs)?\b|\ba different (?:client|customer|trader|user|account|investor|member)\b|\bother (?:people|folks)\b|\bothers (?:on|in) (?:the |our )?(?:beta|platform|pod)\b|\b(?:a|one|some) (?:client|customer|trader|user|investor|member)s? of ours\b|\bevery other (?:client|customer|trader|user|account|investor|member)\b|\b(?:most|many|some|all) (?:traders|clients|customers|users|investors|members) (?:on|in|at) (?:our|the) (?:platform|beta)\b/gi,
  },
];

const BASE: Pattern[] = [
  // Typos too (garanteed, gaurantee). Not after a negation: "we can't guarantee a fill" is honest support.
  {
    category: "returns",
    label: "guarantee",
    re: /(?<!\b(?:can(?:'|’)?t|cannot|not|no|never|doesn(?:'|’)?t|don(?:'|’)?t|won(?:'|’)?t|isn(?:'|’)?t|aren(?:'|’)?t)\s+(?:\w+\s+)?)\bg(?:ua|au|a)r[ae]nt(?:ee|y)(?:d|s)?\b/gi,
  },
  { category: "returns", label: "risk-free", re: /\brisk[- ]?free\b/gi },
  { category: "returns", label: "zero risk", re: /\bzero[- ]?ris[ck]\b|\bno[- ]risk (?:setups?|strateg(?:y|ies)|trades?|investments?|returns?|profits?|plays?)\b/gi },
  { category: "returns", label: "can't lose", re: /\b(?:can(?:'|’)?t|cannot|won(?:'|’)?t) (?:lose|go wrong|miss)\b/gi },
  {
    category: "returns",
    label: "will make or earn",
    re: /(?:\b(?:will|should|could|can|would|going to|gonna)|'ll|’ll) (?:\w+ )?(?:make|earn|net) (?:you |them )?(?:money|a profit|profits?|returns?|gains?|a killing|\$\s?\d|\d+(?:\.\d+)?\s?%)|(?:\bwill|'ll|’ll) (?:\w+ )?profit\b/gi,
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
      `\\b(?:I|we)(?:'d|’d| would)? (?:(?:strongly|really|definitely)\\s+)?(?:rec+om+end|sug+est|advise|encourage)(?: (?:that )?you)?(?: to)? (?:consider(?:ing)? )?${TRADE_VERB}\\b`,
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
      `${MARKET_SUBJECT}(?:\\s+|(?=['’]s ))${MOVE_PREDICTION}|${PRONOUN_MOVE}`,
      "gi",
    ),
  },
  { category: "advice", label: "now is a good time to", re: /\bnow is (?:a )?(?:good|great|the|the right|the perfect) time to\b/gi },
  { category: "advice", label: "buy/sell now", re: /\b(?:buy|sell) (?:it |them |more )?now\b/gi },
  // Added 15 Oct 2026 from the training split of guard.eval (see guard.eval/README.md).
  ...TUNED,
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
  { category: "advice", label: "will go up/down", re: new RegExp(`${TICKER}\\s+${MOVE_PREDICTION}|\\b[Ee]xpect ${TICKER} to ${MOVE_VERB}\\b`, "g") },
  { category: "advice", label: "buy more", re: /\band (?:buy|sell) [A-Z][A-Za-z]{1,9}\b|\b[Gg]et (?:out of|into|in on) (?!I\b)[A-Z]{2,5}\b|\b[Gg]rab (?!I\b)[A-Z]{2,5}\b/g },
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
  // Match on the normalized text (look-alike letters, invisible characters, spelled-out
  // words undone) and report each hit at its place in the original, for the highlight.
  const n = normalize(text);
  const hits: GuardHit[] = [];
  for (const p of patterns) {
    for (const m of n.text.matchAll(p.re)) {
      let start = m.index ?? 0;
      const end = start + m[0].length;
      while (start < end && /[\s.!?;:,]/.test(n.text[start])) start++; // a sentence-start match brings its ". "
      if (start >= end) continue;
      const index = n.from[start];
      hits.push({ category: p.category, label: p.label, match: text.slice(index, n.to[end - 1]), index });
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
