"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { onStepPage, TOUR } from "@/lib/tour";
import { useTour } from "./tourStore";

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 6;
const CARD_W = 380;
const PHONE = 640;

function sameRect(a: Rect | null, b: Rect | null) {
  return a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Follows the step's target on screen: scrolls it into view once, then tracks
 * its box every frame (pages hydrate, rows expand, panels grow). Also reports
 * whether the step's action control exists.
 */
function useTarget(selector: string | null, actionSelector: string | null) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [hasAction, setHasAction] = useState(false);
  useEffect(() => {
    if (!selector) return;
    let frame = 0;
    let scrolled = false;
    let last: Rect | null = null;
    let lastAction = false;
    const tick = () => {
      const el = document.querySelector<HTMLElement>(selector);
      let next: Rect | null = null;
      if (el) {
        if (!scrolled) {
          scrolled = true;
          el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
        }
        const r = el.getBoundingClientRect();
        next = { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) };
      }
      if (!sameRect(next, last)) {
        last = next;
        setRect(next);
      }
      const action = actionSelector ? Boolean(document.querySelector(actionSelector)) : false;
      if (action !== lastAction) {
        lastAction = action;
        setHasAction(action);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setRect(null);
    };
  }, [selector, actionSelector]);
  return { rect, hasAction };
}

function subscribeViewport(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}

/** Viewport size as "w x h", so resizes re-render without state in an effect. */
function useViewport(): [number, number] {
  const v = useSyncExternalStore(subscribeViewport, () => `${window.innerWidth}x${window.innerHeight}`, () => "1280x800");
  const [w, h] = v.split("x").map(Number);
  return [w, h];
}

function typing(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export function TourLayer() {
  const { tour, act } = useTour();
  const pathname = usePathname();
  const params = useSearchParams();
  const running = tour.status === "running";
  const step = TOUR[tour.step];
  const here = running && onStepPage(step, pathname, params);
  const { rect, hasAction } = useTarget(here ? step.target : null, here ? (step.action?.target ?? null) : null);
  const card = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(180);
  const [vw, vh] = useViewport();
  const last = tour.step === TOUR.length - 1;

  // Move focus to the card on every step, so the sentence is read and Enter/Tab land on its buttons.
  useEffect(() => {
    if (running) card.current?.focus({ preventScroll: true });
  }, [running, tour.step]);

  // The card's height decides whether it fits below the target.
  useEffect(() => {
    const el = card.current;
    if (!running || !el) return;
    const ro = new ResizeObserver(() => setCardH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [running, tour.step]);

  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === "ArrowRight") act({ type: "next" });
      else if (e.key === "ArrowLeft") act({ type: "back" });
      else if (e.key === "Escape") act({ type: "pause" });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, act]);

  if (!running) return null;

  const phone = vw < PHONE;
  let style: React.CSSProperties;
  if (phone || !rect) {
    style = phone
      ? { left: 8, right: 8, bottom: "calc(60px + env(safe-area-inset-bottom))" }
      : { right: 24, bottom: 24, width: CARD_W };
  } else {
    const below = rect.top + rect.height + PAD + 12;
    const above = rect.top - PAD - 12 - cardH;
    const top = below + cardH < vh - 12 ? below : above > 12 ? above : Math.max(12, vh - cardH - 24);
    const left = Math.min(Math.max(12, rect.left), vw - CARD_W - 12);
    style = { top, left, width: CARD_W };
  }

  const pressAction = () => {
    if (step.action) document.querySelector<HTMLElement>(step.action.target)?.click();
  };

  return (
    <>
      {here && rect && (
        <div
          aria-hidden
          data-testid="tour-spotlight"
          className="tour-spotlight pointer-events-none fixed z-40 rounded-[8px]"
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
        />
      )}
      <div
        ref={card}
        key={tour.step}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-step"
        aria-describedby="tour-text"
        tabIndex={-1}
        className="tour-card fixed z-50 rounded-panel border border-rule-strong bg-surface p-4 text-ink shadow-[var(--lift)] outline-none"
        style={style}
      >
        <div className="flex items-center gap-3">
          <ol className="flex gap-1" aria-hidden>
            {TOUR.map((s, i) => (
              <li key={s.id} className={`h-1 w-5 rounded-full ${i < tour.step ? "bg-ink-3" : i === tour.step ? "bg-accent-ink" : "bg-rule"}`} />
            ))}
          </ol>
          <p id="tour-step" className="t-cond text-[12px] text-ink-2">
            Step {tour.step + 1} of {TOUR.length}, {step.page}
          </p>
          <button
            type="button"
            onClick={() => act({ type: "pause" })}
            aria-label="Pause the tour"
            className="press -mr-1 ml-auto rounded-[4px] p-1 text-ink-3 hover:bg-sunk hover:text-ink"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </div>

        <p id="tour-text" className="mt-2.5 text-[15px] leading-snug">
          {here ? step.text : `This step is on ${step.page}.`}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!here ? (
            <button type="button" className="press rounded-[4px] border border-accent-edge bg-accent px-3 py-1.5 text-[13px] font-semibold text-on-accent" onClick={() => act({ type: "goto", step: tour.step })}>
              Go to {step.page}
            </button>
          ) : (
            <>
              {tour.step > 0 && (
                <button type="button" className="press rounded-[4px] border border-rule-strong px-3 py-1.5 text-[13px] font-semibold hover:bg-sunk" onClick={() => act({ type: "back" })}>
                  Back
                </button>
              )}
              {step.action && hasAction && (
                <button type="button" className="press rounded-[4px] border border-rule-strong px-3 py-1.5 text-[13px] font-semibold hover:bg-sunk" onClick={pressAction}>
                  {step.action.label}
                </button>
              )}
              <button
                type="button"
                data-testid="tour-next"
                className="press ml-auto rounded-[4px] border border-accent-edge bg-accent px-3 py-1.5 text-[13px] font-semibold text-on-accent"
                onClick={() => act({ type: "next" })}
              >
                {last ? "Finish" : "Next"}
              </button>
            </>
          )}
        </div>

        <div className="mt-3 flex items-center gap-3 border-t border-rule pt-2.5 text-[12px] text-ink-3">
          <button type="button" className="whitespace-nowrap underline hover:text-ink" onClick={() => act({ type: "pause" })}>
            Skip tour
          </button>
          <span className="hidden whitespace-nowrap sm:inline">Resume it any time.</span>
          <span className="ml-auto hidden items-center gap-1 sm:inline-flex" aria-hidden>
            <kbd className="kbd">←</kbd>
            <kbd className="kbd">→</kbd>
            <kbd className="kbd">Esc</kbd>
          </span>
        </div>
      </div>
    </>
  );
}
