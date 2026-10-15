// What the guard matches against: the text with the usual tricks undone, and
// a map from every character of the result back to the original, so a hit
// can be highlighted where the person typed it (night run, 15 Oct 2026).
//
// Undone: compatibility forms (fullwidth letters, ligatures) and accents
// (NFKD, then marks dropped); Cyrillic and Greek letters that look Latin;
// zero-width characters, soft hyphens and other invisible format characters;
// every kind of space and line break, collapsed to one space; dash variants;
// and words spelled out letter by letter ("g-u-a-r-a-n-t-e-e", "r i s k").

export type Normalized = {
  text: string;
  /** For each character of `text`, where its source starts in the original. */
  from: number[];
  /** For each character of `text`, where its source ends in the original (exclusive). */
  to: number[];
};

// Letters from other scripts that render like Latin ones. Not every homoglyph,
// the ones a person can type that look identical in a normal UI font.
const LOOKALIKE: Record<string, string> = {
  // Cyrillic
  "\u0430": "a", "\u0432": "b", "\u0435": "e", "\u0451": "e", "\u043a": "k", "\u043c": "m", "\u043d": "h", "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0442": "t", "\u0443": "y", "\u0445": "x", "\u0455": "s", "\u0456": "i", "\u0457": "i", "\u0458": "j", "\u0501": "d", "\u04bb": "h", "\u051b": "q", "\u051d": "w", "\u0261": "g",
  "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u0401": "E", "\u041a": "K", "\u041c": "M", "\u041d": "H", "\u041e": "O", "\u0420": "P", "\u0421": "C", "\u0422": "T", "\u0423": "Y", "\u0425": "X", "\u0405": "S", "\u0406": "I", "\u0407": "I", "\u0408": "J",
  // Greek
  "\u03b1": "a", "\u03b2": "b", "\u03b5": "e", "\u03b9": "i", "\u03ba": "k", "\u03bd": "v", "\u03bf": "o", "\u03c1": "p", "\u03c4": "t", "\u03c5": "u", "\u03c7": "x", "\u03c9": "w",
  "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0396": "Z", "\u0397": "H", "\u0399": "I", "\u039a": "K", "\u039c": "M", "\u039d": "N", "\u039f": "O", "\u03a1": "P", "\u03a4": "T", "\u03a5": "Y", "\u03a7": "X",
};

// Format characters that render as nothing.
const INVISIBLE = /^[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufe00-\ufe0f\ufeff]$/u;
const MARK = /^\p{M}$/u;
const SPACE = /^\s$/u;
const DASH = /^[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]$/u;

// Three or more single letters joined by the same separator: "g-u-a-r-a-n-t-e-e", "r i s k".
const SPELLED = /(?<![\p{L}\p{N}])\p{L}([-._* ])\p{L}(?![\p{L}\p{N}])(?:\1\p{L}(?![\p{L}\p{N}]))+/gu;

export function normalize(original: string): Normalized {
  let text = "";
  const from: number[] = [];
  const to: number[] = [];
  const push = (s: string, start: number, end: number) => {
    for (const ch of s) {
      text += ch;
      for (let k = 0; k < ch.length; k++) {
        from.push(start);
        to.push(end);
      }
    }
  };

  let i = 0;
  for (const cp of original) {
    const start = i;
    const end = i + cp.length;
    i = end;
    if (INVISIBLE.test(cp) || MARK.test(cp)) continue;
    if (SPACE.test(cp)) {
      if (text.endsWith(" ")) {
        to[to.length - 1] = end; // the one space stands for the whole run
        continue;
      }
      push(" ", start, end);
      continue;
    }
    if (DASH.test(cp)) {
      push("-", start, end);
      continue;
    }
    const decomposed = cp.normalize("NFKD");
    for (const part of decomposed) {
      if (MARK.test(part) || INVISIBLE.test(part)) continue;
      push(LOOKALIKE[part] ?? part, start, end);
    }
  }

  // Spelled-out words: drop the separators inside each run.
  if (SPELLED.test(text)) {
    SPELLED.lastIndex = 0;
    const keep = new Array<boolean>(text.length).fill(true);
    for (const m of text.matchAll(SPELLED)) {
      for (let k = m.index! + 1; k < m.index! + m[0].length; k += 2) keep[k] = false;
    }
    let t = "";
    const f: number[] = [];
    const e: number[] = [];
    for (let k = 0; k < text.length; k++) {
      if (!keep[k]) continue;
      t += text[k];
      f.push(from[k]);
      e.push(to[k]);
    }
    return { text: t, from: f, to: e };
  }
  return { text, from, to };
}
