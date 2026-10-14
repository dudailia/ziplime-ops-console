import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Reads the colour tokens straight out of globals.css, so a token edit that
// breaks WCAG AA fails here instead of on someone's screen (DESIGN.md, Colour).

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no ${selector} block in globals.css`);
  const body = css.slice(at, css.indexOf("}", at));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = { night: block(":root"), day: block(':root[data-theme="light"]') };
const BACKGROUNDS = ["ground", "surface", "sunk"];
// Every token that is ever text or a status mark. Each must read on every background.
const TEXT = ["ink", "ink-2", "ink-3", "accent-ink", "pixel", "place", "refuse", "skip", "cancel", "ok", "warn", "bad", "none"];

describe("colour contrast (WCAG AA)", () => {
  it("night is pure black with ziplime's ink and lime", () => {
    expect(THEMES.night.ground).toBe("#000000");
    expect(THEMES.night.ink).toBe("#f2f0ff");
    expect(THEMES.night.accent).toBe("#a6f656");
    expect(THEMES.night.pixel).toBe("#4dcfe7");
  });

  for (const [theme, t] of Object.entries(THEMES)) {
    for (const fg of TEXT) {
      it(`${theme}: ${fg} is at least 4.5:1 on ${BACKGROUNDS.join(", ")}`, () => {
        for (const bg of BACKGROUNDS) {
          expect(t[fg], `--${fg}`).toBeDefined();
          expect(contrast(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      });
    }

    it(`${theme}: text on lime and status text on its soft fill pass 4.5:1`, () => {
      expect(contrast(t["on-accent"], t.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["on-highlight"], t.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.refuse, t["refuse-soft"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.place, t["place-soft"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.skip, t["skip-soft"])).toBeGreaterThanOrEqual(4.5);
    });

    it(`${theme}: control borders reach 3:1, the bar for UI boundaries`, () => {
      for (const bg of BACKGROUNDS) expect(contrast(t["rule-strong"], t[bg]), `rule-strong on ${bg}`).toBeGreaterThanOrEqual(3);
    });
  }

  it("auto in a light system uses exactly the day tokens", () => {
    const at = css.indexOf(':root[data-theme="auto"] {');
    const auto = Object.fromEntries(
      [...css.slice(at, css.indexOf("}", at)).matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2].toLowerCase()]),
    );
    expect(auto).toEqual(THEMES.day);
  });
});
