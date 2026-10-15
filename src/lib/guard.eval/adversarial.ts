// Texts written to get past a phrase list: look-alike letters from other
// scripts, invisible characters, line breaks, extra spaces, fullwidth letters
// and spelled-out words. All must be caught, and the highlight must cover
// `span`, the offending part of the original text. Escapes keep the tricks
// visible in this file.

import type { GuardCategory } from "../guard";

export type Adversarial = { name: string; text: string; category: GuardCategory; span: string };

const CYR_A = "\u0430"; // Cyrillic a
const CYR_E = "\u0435"; // Cyrillic e
const CYR_O = "\u043e"; // Cyrillic o
const CYR_U = "\u0443"; // Cyrillic u (looks like y)
const CYR_I = "\u0456"; // Ukrainian i
const GRK_O = "\u03bf"; // Greek omicron
const GRK_NU = "\u03bd"; // Greek nu (looks like v)
const ZWSP = "\u200b";
const ZWJ = "\u200d";
const ZWNJ = "\u200c";
const WJ = "\u2060";
const BOM = "\ufeff";
const SHY = "\u00ad";
const NBSP = "\u00a0";
const NB_HYPHEN = "\u2011";

const fullwidth = (s: string) => [...s].map((c) => (c === " " ? "\u3000" : String.fromCodePoint(c.codePointAt(0)! + 0xfee0))).join("");

const make = (name: string, before: string, span: string, after: string, category: GuardCategory): Adversarial => ({
  name,
  text: before + span + after,
  category,
  span,
});

export const ADVERSARIAL: readonly Adversarial[] = [
  make("Cyrillic a in guarantee", "We ", `gu${CYR_A}rantee`, " a profit.", "returns"),
  make("Cyrillic e and a in guaranteed", "Returns are ", `gu${CYR_A}rant${CYR_E}${CYR_E}d`, ".", "returns"),
  make("Cyrillic o in should", "", `You sh${CYR_O}uld buy`, " more AAPL.", "advice"),
  make("Cyrillic u for y in buy", "", `You should bu${CYR_U}`, " more AAPL.", "advice"),
  make("Greek omicron in recommend", "", `We rec${GRK_O}mmend buying`, " the dip.", "advice"),
  make("Cyrillic e in risk-free", "This is ", `risk-fr${CYR_E}${CYR_E}`, ".", "returns"),
  make("Ukrainian i in risk", "", `Zero r${CYR_I}sk`, " with this setting.", "returns"),
  make("Greek nu for v in investors", "", `Other in${GRK_NU}estors`, " saw the same refusal.", "other-clients"),
  make("Cyrillic capital A in a ticker", "", `\u0410APL will rally`, " next week.", "advice"),
  make("zero-width space inside guarantee", "We ", `guar${ZWSP}antee`, " it.", "returns"),
  make("zero-width joiner inside buy", "", `You should b${ZWJ}uy`, " more NVDA.", "advice"),
  make("zero-width non-joiner and word joiner", "", `You sh${ZWNJ}ould s${WJ}ell`, " now.", "advice"),
  make("byte order mark inside a word", "This is ", `risk${BOM}-free`, ".", "returns"),
  make("soft hyphen inside guaranteed", "It's ", `guaran${SHY}teed`, " to work.", "returns"),
  make("line break inside the phrase", "", "You should\nbuy", " more AAPL.", "advice"),
  make("CRLF and indent inside the phrase", "", "We recommend\r\n   buying", " the dip.", "advice"),
  make("extra spaces", "", "You   should    definitely   buy", " more AAPL.", "advice"),
  make("tabs", "", "You\tshould\tbuy", " more AAPL.", "advice"),
  make("no-break spaces", "", `You${NBSP}should${NBSP}buy`, " more AAPL.", "advice"),
  make("non-breaking hyphen in risk-free", "This is ", `risk${NB_HYPHEN}free`, ".", "returns"),
  make("fullwidth guarantee", "We ", fullwidth("guarantee"), " a profit.", "returns"),
  make("fullwidth sentence", "", fullwidth("You should buy"), fullwidth(" more AAPL."), "advice"),
  make("fullwidth ticker", "", `${fullwidth("NVDA")} will rally`, ".", "advice"),
  make("spelled out with hyphens", "We ", "g-u-a-r-a-n-t-e-e", " it.", "returns"),
  make("spelled out with spaces", "Returns are ", "g u a r a n t e e d", ".", "returns"),
  make("spelled out with dots", "It's ", "r.i.s.k-f.r.e.e", ".", "returns"),
  make("spelled out with underscores", "", "z_e_r_o r_i_s_k", " here.", "returns"),
  make("mixed tricks", "", `Y${CYR_O}u  sh${ZWSP}ould\nbu${CYR_U}`, " more TSLA.", "advice"),
  make("combining accent on a letter", "We ", "gu\u0301arantee", " it.", "returns"),
  make("ligature in profit", "You will ", "pro\ufb01t", " from this.", "returns"),
];
