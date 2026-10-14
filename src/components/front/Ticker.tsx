"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { EVENT_TEXT, EVENT_WORD } from "@/components/ui/kit";
import type { TickerItem } from "@/lib/front";

// Pixels per second. Slow enough to read a whole item as it passes.
const SPEED = 40;

/**
 * Real seed events scrolling across the top, like ziplime's strategy ticker.
 * One copy of the list (so page text and screen readers read each event once):
 * the first pass starts with the strip already full, every later pass enters
 * from the right. Pauses on hover, on focus and with its button. Under reduced
 * motion it doesn't move; the strip scrolls sideways by hand instead.
 */
export function Ticker({ items }: { items: TickerItem[] }) {
  const strip = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLUListElement>(null);
  const [paused, setPaused] = useState(false);

  // Durations depend on the measured widths, so the speed is the same on every
  // screen and both passes move at the same pace.
  useLayoutEffect(() => {
    const s = strip.current;
    const t = track.current;
    if (!s || !t) return;
    const set = () => {
      const w = t.scrollWidth;
      t.style.setProperty("--first", `${w / SPEED}s`);
      t.style.setProperty("--loop", `${(w + s.clientWidth) / SPEED}s`);
      t.style.setProperty("--enter", `${s.clientWidth}px`);
      t.dataset.run = "true";
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(s);
    return () => ro.disconnect();
  }, []);

  return (
    <section aria-label="Dry-run events from the seed, Mon 12 Oct" className="ticker flex items-stretch border-b border-rule bg-surface font-mono text-[11px] tracking-[0.04em]">
      <div ref={strip} className="ticker-strip min-w-0 flex-1" data-paused={paused} tabIndex={0}>
        <ul ref={track} className="ticker-track">
          {items.map((it) => (
            <li key={it.key} className="mx-[18px] inline-block">
              <span className="text-ink-3">@{it.account}</span> <span className="font-semibold text-ink">{it.symbol}</span>{" "}
              <span className={`font-semibold ${EVENT_TEXT[it.event]}`}>{EVENT_WORD[it.event].toLowerCase()}</span>
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        aria-pressed={paused}
        aria-label={paused ? "Play the ticker" : "Pause the ticker"}
        onClick={() => setPaused((p) => !p)}
        className="ticker-pause flex w-9 shrink-0 items-center justify-center border-l border-rule text-ink-2 hover:text-ink"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          {paused ? <path d="M2 1v8l7-4z" fill="currentColor" /> : <path d="M2 1h2v8H2zM6 1h2v8H6z" fill="currentColor" />}
        </svg>
      </button>
    </section>
  );
}
