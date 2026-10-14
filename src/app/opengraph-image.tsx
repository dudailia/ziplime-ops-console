import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { frontDoorNumbers } from "@/lib/crm";
import { STATIC_DATASET } from "@/lib/data/static";
import { tickerItems } from "@/lib/front";
import { EVENT_WORD } from "@/components/ui/kit";

export const alt = "ziplime Ops Console. Every order checked. Nothing sent. Now you can see why. Built on ziplime PR #39. Sample data.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Night tokens from globals.css (DESIGN.md).
const C = {
  ground: "#000000",
  surface: "#0b0a10",
  rule: "#1e1d25",
  ink: "#f2f0ff",
  ink2: "#b4b1c2",
  ink3: "#8f8c9b",
  lime: "#a6f656",
  onHighlight: "#0b0a10",
  pixel: "#4dcfe7",
  refuse: "#ff3355",
  skip: "#f5b83d",
  bad: "#ff5c7a",
};

// The link preview, in the front door's look: the headline with its lime word
// and Doto word, and the three seed numbers. Always the public demo's seed: a
// link preview is for people who can't sign in to a database deployment.
// Satori reads woff, not woff2. JetBrains Mono and Doto are OFL and live in
// src/app/og; General Sans is fetched before the build (scripts/fetch-fonts.mjs).
const font = (dir: string, name: string) => readFile(join(process.cwd(), "src/app", dir, name));

// Drawn, not typed: none of the bundled fonts has "→", and next/og would fetch
// the glyph from Google Fonts on every render (and fail with no network).
function Arrow() {
  return (
    <svg width="18" height="10" viewBox="0 0 18 10">
      <path d="M0 5h16M12 1l4 4-4 4" fill="none" stroke={C.ink2} strokeWidth="1.6" />
    </svg>
  );
}

export default async function OpenGraphImage() {
  const [display, mono, monoBold, pixel] = await Promise.all([
    font("fonts", "GeneralSans-Bold.woff"),
    font("og", "JetBrainsMono-Regular.woff"),
    font("og", "JetBrainsMono-Bold.woff"),
    font("og", "Doto-ExtraBold.woff"),
  ]);
  const n = frontDoorNumbers(STATIC_DATASET);
  // One real event of each outcome from the ticker, in the ticker's order.
  const all = tickerItems(STATIC_DATASET, Infinity);
  const OUTCOMES = (["refuse", "place", "skip"] as const).flatMap((k) => all.find((t) => t.event === k) ?? []);
  const label = { fontFamily: "Mono", fontSize: 16, letterSpacing: 1, color: C.ink3, textTransform: "uppercase" } as const;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: C.ground,
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.16) 1.5px, transparent 2px)",
          backgroundSize: "32px 32px",
          color: C.ink,
          padding: "52px 72px",
          fontFamily: "Mono",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 5, width: 40, height: 40, background: C.surface, border: `1px solid #6b6878`, padding: "8px 9px" }}>
            <div style={{ width: 5, height: 13, background: C.ink, opacity: 0.55 }} />
            <div style={{ width: 5, height: 18, background: C.ink, opacity: 0.8 }} />
            <div style={{ width: 5, height: 23, background: C.lime }} />
          </div>
          <div style={{ display: "flex", fontSize: 24 }}>
            <span style={{ fontWeight: 700 }}>ziplime</span>
            <span style={{ marginLeft: 12, color: C.ink2 }}>ops console</span>
          </div>
          <div style={{ display: "flex", marginLeft: "auto", ...label }}>Unofficial concept. Sample data.</div>
        </div>

        <div style={{ display: "flex", alignSelf: "flex-start", alignItems: "center", gap: 12, marginTop: 40, padding: "8px 14px", border: `1px solid ${C.rule}`, background: C.surface, ...label, color: C.ink2 }}>
          <div style={{ width: 8, height: 8, background: C.lime }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span>Engine</span>
            <Arrow />
            <span>dry run</span>
            <Arrow />
            <span>console</span>
          </div>
          <span style={{ color: C.ink }}>{"// built on ziplime PR #39"}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 24, fontFamily: "Display", fontSize: 60, lineHeight: 1.04, letterSpacing: -1.2, textTransform: "uppercase" }}>
          {/* Satori shrinks an inline span with a background, so each piece is its own flex item. */}
          <div style={{ display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
            <span style={{ marginRight: 18 }}>Every order</span>
            <div style={{ display: "flex", background: C.lime, color: C.onHighlight, padding: "0 8px" }}>checked</div>
            <span>.</span>
          </div>
          <div style={{ display: "flex", whiteSpace: "nowrap" }}>Nothing sent.</div>
          <div style={{ display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
            <span style={{ marginRight: 18 }}>Now you can see</span>
            <span style={{ fontFamily: "Pixel", color: C.pixel, letterSpacing: 0 }}>why.</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 30, marginTop: 26, fontSize: 16, letterSpacing: 0.5, overflow: "hidden" }}>
          {OUTCOMES.map((t) => (
            <div key={t.key} style={{ display: "flex", gap: 8, whiteSpace: "nowrap" }}>
              <span style={{ color: C.ink3 }}>@{t.account}</span>
              <span style={{ fontWeight: 700 }}>{t.symbol}</span>
              <span style={{ fontWeight: 700, color: t.event === "refuse" ? C.refuse : t.event === "place" ? C.lime : C.skip }}>{EVENT_WORD[t.event].toLowerCase()}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", marginTop: "auto", border: `1px solid ${C.rule}`, background: C.surface }}>
          {(
            [
              [String(n.orders), "", "orders checked", C.ink],
              [String(n.refused), "", "refused before Lime", C.refuse],
              [String(n.needHelp), ` of ${n.accounts}`, "accounts need help", C.bad],
            ] as const
          ).map(([v, of, l, tone], i) => (
            <div key={l} style={{ display: "flex", flexDirection: "column", flex: 1, padding: "18px 24px", borderLeft: i ? `1px solid ${C.rule}` : "none" }}>
              <div style={{ display: "flex", alignItems: "baseline", fontWeight: 700, fontSize: 46, letterSpacing: -1.5, color: tone }}>
                {v}
                {of && <span style={{ fontSize: 22, color: C.ink3, marginLeft: 6 }}>{of}</span>}
              </div>
              <div style={{ display: "flex", ...label, fontSize: 15 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Display", data: display, weight: 700, style: "normal" },
        { name: "Mono", data: mono, weight: 400, style: "normal" },
        { name: "Mono", data: monoBold, weight: 700, style: "normal" },
        { name: "Pixel", data: pixel, weight: 800, style: "normal" },
      ],
    },
  );
}
