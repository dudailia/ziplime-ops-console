"use client";

import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import type { HeroLine } from "@/lib/front";

// Typed once per page load; Replay runs it again.
let played = false;

// Milliseconds per character, and the pause between the two rows.
const ENGINE_MS = 6;
const CONSOLE_MS = 12;
const GAP_MS = 350;

function reduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The hero's terminal: types the real dry-run line the engine wrote, then the
 * console's plain-English reading of it.
 *
 * Every word is in the DOM from the first render, once. Typing only moves the
 * split between a visible part and a transparent rest, so the panel never
 * changes size, and screen readers and copied text always get the whole line.
 */
export function HeroTerminal({ hero, file, metrics }: { hero: HeroLine; file: string; metrics: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const x = hero.explanation;

  const run = useCallback(() => {
    const el = root.current;
    if (!el) return;
    cancelAnimationFrame(frame.current);
    const segs = [...el.querySelectorAll<HTMLElement>("[data-type]")].map((seg) => ({
      seg,
      shown: seg.querySelector<HTMLElement>("[data-shown]")!,
      rest: seg.querySelector<HTMLElement>("[data-rest]")!,
      text: seg.dataset.type!,
      ms: seg.dataset.speed === "engine" ? ENGINE_MS : CONSOLE_MS,
    }));
    // Each segment's start time: they type one after another.
    let t = 0;
    const starts = segs.map((s, i) => {
      const at = t + (i > 0 && segs[i - 1].ms !== s.ms ? GAP_MS : 0);
      t = at + s.text.length * s.ms;
      return at;
    });
    const end = t;
    el.dataset.state = "typing";
    const begin = performance.now();
    const tick = (now: number) => {
      const elapsed = now - begin;
      segs.forEach((s, i) => {
        const n = Math.max(0, Math.min(s.text.length, Math.floor((elapsed - starts[i]) / s.ms)));
        if (s.shown.textContent!.length !== n) {
          s.shown.textContent = s.text.slice(0, n);
          s.rest.textContent = s.text.slice(n);
        }
        s.seg.dataset.active = String(elapsed >= starts[i] && n < s.text.length);
      });
      if (elapsed < end) frame.current = requestAnimationFrame(tick);
      else finish();
    };
    const finish = () => {
      segs.forEach((s) => {
        s.shown.textContent = s.text;
        s.rest.textContent = "";
        s.seg.dataset.active = "false";
      });
      el.dataset.state = "done";
    };
    frame.current = requestAnimationFrame(tick);
  }, []);

  useLayoutEffect(() => {
    if (played || reduced()) return;
    played = true;
    run();
    return () => cancelAnimationFrame(frame.current);
  }, [run]);

  return (
    <div ref={root} className="terminal border border-rule bg-surface" data-state="done">
      <div className="flex items-center gap-3 border-b border-rule bg-wash px-3.5 py-2.5 font-mono text-[11px] text-ink-2">
        <span aria-hidden className="pulse size-1.5 shrink-0 bg-accent" />
        <span className="min-w-0 truncate">{file}</span>
        <span className="ml-auto shrink-0 border border-rule px-2 py-0.5 text-[10px] text-ink-3">line {hero.event.line}</span>
        <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold tracking-[0.1em] text-accent-ink">
          <span aria-hidden className="pulse size-1.5 rounded-full bg-accent" />
          DRY RUN
        </span>
      </div>

      <div className="flex flex-col gap-3.5 border-b border-rule px-4 py-4 sm:px-5">
        <Row tag="engine">
          <Typed text={hero.event.raw} speed="engine" className="font-mono text-[12px] leading-[1.6] text-ink [overflow-wrap:anywhere]" />
        </Row>
        <Row tag="console">
          <p className="text-[14px] leading-[1.5] text-ink">
            <Typed text={x.title} className="font-semibold" />{" "}
            <Typed text={x.happened} className="text-ink-2" />
          </p>
          <p className="mt-1.5 text-[13px] leading-[1.5] text-ink-2">
            <Typed text={`Fix: ${x.change}`} />
          </p>
        </Row>
        <div className="flex justify-end motion-reduce:hidden">
          <button type="button" onClick={run} className="t-label inline-flex items-center gap-1.5 hover:text-ink">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path d="M8.5 5A3.5 3.5 0 1 1 5 1.5h2M6 0l1.5 1.5L6 3" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            Replay
          </button>
        </div>
      </div>

      {metrics}
    </div>
  );
}

function Row({ tag, children }: { tag: "engine" | "console"; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={`mt-[3px] w-[60px] shrink-0 py-px text-center font-mono text-[9px] font-semibold tracking-[0.1em] uppercase ${
          tag === "engine" ? "bg-ink text-ground" : "bg-accent text-on-highlight"
        }`}
      >
        {tag}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Text that can be typed in place: shown part, a caret, and a transparent rest. */
function Typed({ text, speed = "console", className = "" }: { text: string; speed?: "engine" | "console"; className?: string }) {
  return (
    <span data-type={text} data-speed={speed} data-active="false" className={className}>
      <span data-shown>{text}</span>
      <span aria-hidden className="caret" />
      <span data-rest className="text-transparent" />
    </span>
  );
}
