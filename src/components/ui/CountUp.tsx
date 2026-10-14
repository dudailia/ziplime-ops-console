"use client";

import { useLayoutEffect, useRef } from "react";

// Ids that have already counted in this page load: a KPI counts up once, not
// on every visit back to the page.
const counted = new Set<string>();

const DURATION = 600;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

function reduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A KPI number that counts up from zero the first time it's shown.
 *
 * The final value is always in the markup: it reserves the width (so nothing
 * shifts) and it's what assistive tech reads. Until the count starts, the
 * moving copy is hidden by CSS, and a CSS fallback reveals it after 1.2 s if
 * script never runs.
 */
export function CountUp({ value, id, format = String }: { value: number; id?: string; format?: (n: number) => string }) {
  const live = useRef<HTMLSpanElement>(null);
  const key = id ?? null;

  useLayoutEffect(() => {
    const el = live.current;
    if (!el) return;
    const done = () => {
      el.textContent = format(value);
      el.dataset.state = "done";
    };
    if ((key && counted.has(key)) || value === 0 || reduced()) return done();
    if (key) counted.add(key);
    el.textContent = format(0);
    el.dataset.state = "counting";
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / DURATION);
      el.textContent = format(Math.round(easeOut(t) * value));
      if (t < 1) frame = requestAnimationFrame(tick);
      else done();
    });
    return () => {
      cancelAnimationFrame(frame);
      done();
    };
  }, [value, key, format]);

  return (
    <span className="countup inline-grid tabular-nums">
      <span className="col-start-1 row-start-1 select-none opacity-0" aria-hidden>
        {format(value)}
      </span>
      <span ref={live} className="col-start-1 row-start-1" data-state="pending" aria-hidden>
        {format(value)}
      </span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
