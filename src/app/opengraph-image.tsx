import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { frontDoorNumbers } from "@/lib/crm";
import { SESSION_CLOSE_MINUTE, SESSION_OPEN_MINUTE } from "@/lib/dryrun/time";
import { DEPLOYMENTS, seedFile, SEED_ACCOUNTS } from "@/lib/seed";

export const alt = "ziplime Ops Console: an ops layer for ziplime's dry-run mode, built on PR #39. Sample data.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const C = {
  ground: "#0d1215",
  surface: "#141a1e",
  rule: "#2a343b",
  ink: "#e4e9ec",
  ink2: "#a4b0b8",
  ink3: "#7a8790",
  lime: "#c5ef3a",
  place: "#7ea3ff",
  refuse: "#ff6f64",
  cancel: "#8b98a1",
};

// The link preview: the headline, the front door's hero session as a strip of
// marks, and the three numbers. Everything is computed from the seed.
// Archivo (SIL Open Font License), static instances, so the preview matches the app's type.
const font = (name: string) => readFile(join(process.cwd(), "src/app/og", name));

export default async function OpenGraphImage() {
  const [regular, semi, wide] = await Promise.all([font("Archivo-Regular.ttf"), font("Archivo-SemiBold.ttf"), font("ArchivoExpanded-ExtraBold.ttf")]);
  const n = frontDoorNumbers(SEED_ACCOUNTS, DEPLOYMENTS);
  const session = seedFile("priya-growth").sessions.find((s) => s.date === "2026-10-07")!;
  const lanes = [...new Set(session.events.map((e) => e.symbol ?? "?"))].sort();
  const W = 1040;
  const x = (m: number) => ((Math.min(SESSION_CLOSE_MINUTE, Math.max(SESSION_OPEN_MINUTE, m)) - SESSION_OPEN_MINUTE) / (SESSION_CLOSE_MINUTE - SESSION_OPEN_MINUTE)) * (W - 90) + 70;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.ground, color: C.ink, padding: "56px 80px", fontFamily: "Archivo" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 5, width: 40, height: 40, borderRadius: 8, background: "#12181c", border: `1px solid ${C.rule}`, padding: "8px 9px" }}>
            <div style={{ width: 5, height: 13, background: C.ink, opacity: 0.55, borderRadius: 1 }} />
            <div style={{ width: 5, height: 18, background: C.ink, opacity: 0.8, borderRadius: 1 }} />
            <div style={{ width: 5, height: 23, background: C.lime, borderRadius: 1 }} />
          </div>
          <div style={{ display: "flex", fontSize: 26, fontFamily: "ArchivoWide" }}>
            ziplime<span style={{ marginLeft: 8, fontFamily: "Archivo", fontWeight: 400, color: C.ink2 }}>Ops Console</span>
          </div>
          <div style={{ display: "flex", marginLeft: "auto", fontSize: 18, color: C.ink3 }}>Unofficial concept. Sample data.</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 36, fontSize: 54, fontFamily: "ArchivoWide", lineHeight: 1.1, letterSpacing: -0.5 }}>
          <span>An ops layer for ziplime&apos;s</span>
          <span style={{ display: "flex" }}>
            dry-run mode, built on&nbsp;<span style={{ borderBottom: `5px solid ${C.lime}` }}>PR #39</span>
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 40, background: C.surface, border: `1px solid ${C.rule}`, borderRadius: 10, padding: "14px 0 10px", position: "relative", height: 150 }}>
          {lanes.map((sym, i) => (
            <div key={sym} style={{ position: "absolute", left: 0, top: 18 + i * 30, width: W, height: 26, display: "flex", alignItems: "center" }}>
              <div style={{ width: 56, textAlign: "right", fontSize: 15, color: C.ink2, display: "flex", justifyContent: "flex-end" }}>{sym}</div>
              <div style={{ position: "absolute", left: 70, right: 20, top: 13, height: 1, background: C.rule }} />
            </div>
          ))}
          {session.events.map((e) => {
            const top = 18 + lanes.indexOf(e.symbol ?? "?") * 30;
            const left = x(e.clock.minuteET);
            if (e.event === "place") return <div key={e.line} style={{ position: "absolute", left: left - 2, top: top + (e.side === "buy" ? 1 : 13), width: 4, height: 12, background: C.place }} />;
            if (e.event === "refuse")
              return (
                <div key={e.line} style={{ position: "absolute", left: left - 8, top: top + 5, width: 16, height: 16, display: "flex" }}>
                  <div style={{ position: "absolute", left: 7, top: -1, width: 3, height: 18, background: C.refuse, transform: "rotate(45deg)" }} />
                  <div style={{ position: "absolute", left: 7, top: -1, width: 3, height: 18, background: C.refuse, transform: "rotate(-45deg)" }} />
                </div>
              );
            return <div key={e.line} style={{ position: "absolute", left: left - 30, top: top + 3, width: 30, height: 2, background: C.cancel }} />;
          })}
        </div>

        <div style={{ display: "flex", marginTop: 28, gap: 64 }}>
          {[
            [String(n.orders), "orders through the live checks", C.ink],
            [String(n.refused), "refused before reaching Lime", C.refuse],
            [`${n.needHelp} of ${n.accounts}`, "accounts need help", C.refuse],
          ].map(([v, l, tone]) => (
            <div key={l} style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 44, fontFamily: "ArchivoWide", color: tone }}>{v}</div>
              <div style={{ display: "flex", fontSize: 19, fontWeight: 600, color: C.ink2 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Archivo", data: regular, weight: 400, style: "normal" },
        { name: "Archivo", data: semi, weight: 600, style: "normal" },
        { name: "ArchivoWide", data: wide, weight: 800, style: "normal" },
      ],
    },
  );
}
