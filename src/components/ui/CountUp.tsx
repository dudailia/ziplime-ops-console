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
 * The final value is the only text in the markup, so screen readers, link
 * previews and copied text all read it once. It also reserves the width, so
 * nothing shifts. The moving digits are a CSS pseudo-element drawn from
 * `data-n`, with empty alternative text so assistive tech skips it, and the
 * real value is transparent while they run. It isn't a separate aria-hidden
 * span because any extra box, even an empty one, puts a line break into
 * innerText ("5\n of 10"). Until the count starts the value is transparent
 * too, and a CSS fallback shows it after 1.2 s if script never runs.
 */
export function CountUp({ value, id, format = String }: { value: number; id?: string; format?: (n: number) => string }) {
  const root = useRef<HTMLSpanElement>(null);
  const key = id ?? null;

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const done = () => {
      el.dataset.n = format(value);
      el.dataset.state = "done";
    };
    if ((key && counted.has(key)) || value === 0 || reduced()) return done();
    if (key) counted.add(key);
    el.dataset.n = format(0);
    el.dataset.state = "counting";
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / DURATION);
      el.dataset.n = format(Math.round(easeOut(t) * value));
      if (t < 1) frame = requestAnimationFrame(tick);
      else done();
    });
    return () => {
      cancelAnimationFrame(frame);
      done();
    };
  }, [value, key, format]);

  return (
    <span ref={root} className="countup relative inline-block tabular-nums" data-state="pending" data-n={format(value)}>
      <span className="countup-value">{format(value)}</span>
    </span>
  );
}
