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

/** How long, from when the target appears, a step keeps it on screen against scrolls the visitor didn't make. */
const SETTLE_MS = 4000;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

/**
 * True when the target sits in the part of the screen nothing covers. On a
 * phone the card and the tab bar cover the bottom, so that part doesn't count.
 * A target taller than the free space counts once its top is showing.
 */
function inView(r: DOMRect, cover: number) {
  const free = window.innerHeight - cover;
  if (r.height <= free) return r.top >= -1 && r.bottom <= free + 1;
  return r.top >= -1 && r.top <= 32;
}

function scrollToTarget(el: HTMLElement, phone: boolean) {
  const behavior = prefersReducedMotion() ? "auto" : "smooth";
  // On a phone the card covers the bottom, so the target goes near the top; elsewhere, the middle.
  if (phone) window.scrollBy({ top: el.getBoundingClientRect().top - 12, behavior });
  else el.scrollIntoView({ block: "center", behavior });
}

/**
 * Follows the step's target on screen: brings it into view, then tracks its
 * box every frame (pages hydrate, rows expand, panels grow). Also reports
 * whether the step's action control exists.
 *
 * One scroll is not enough. Under load, Next.js renders a client navigation
 * twice and the second render sets scrollTop to 0 even with { scroll: false },
 * which cancels a smooth scroll in flight. So for the first few seconds of a
 * step, if the target is off screen and nothing is scrolling, scroll to it
 * again. The visitor's own wheel, touch or scroll keys end that at once.
 */
function useTarget(selector: string | null, actionSelector: string | null, cover: { current: number }) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [hasAction, setHasAction] = useState(false);
  useEffect(() => {
    if (!selector) return;
    let frame = 0;
    let last: Rect | null = null;
    let lastAction = false;
    let userScrolled = false;
    let lastY = -1;
    let stillFrames = 0;
    let scrolls = 0;
    let yAtScroll = -1;
    let scrolledAt = 0;
    let moved = false;
    let stuck = false;
    // The window starts when the target first exists, so a slow page load doesn't use it up.
    let until = 0;
    const mine = () => (userScrolled = true);
    const onKey = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key)) userScrolled = true;
    };
    window.addEventListener("wheel", mine, { passive: true });
    window.addEventListener("touchmove", mine, { passive: true });
    window.addEventListener("keydown", onKey);
    const tick = () => {
      const el = document.querySelector<HTMLElement>(selector);
      if (el && until === 0) until = performance.now() + SETTLE_MS;
      let next: Rect | null = null;
      if (el) {
        const y = window.scrollY;
        stillFrames = y === lastY ? stillFrames + 1 : 0;
        lastY = y;
        let r = el.getBoundingClientRect();
        const phone = window.innerWidth < PHONE;
        // The first scroll always goes, at once. Later ones wait until scrolling has stopped,
        // and stop for good once a scroll no longer moves the page (the target is as far as it goes).
        if (y !== yAtScroll) moved = true;
        // A smooth scroll can take a few frames to start on a busy page, so give it time.
        if (scrolls > 0 && !moved && performance.now() - scrolledAt > 600) stuck = true;
        const again = scrolls > 0 && !stuck && stillFrames >= 3 && !inView(r, phone ? cover.current : 0);
        if (!userScrolled && performance.now() < until && (scrolls === 0 || again)) {
          scrolls += 1;
          stillFrames = 0;
          yAtScroll = y;
          scrolledAt = performance.now();
          moved = false;
          scrollToTarget(el, phone);
          r = el.getBoundingClientRect();
        }
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
      window.removeEventListener("wheel", mine);
      window.removeEventListener("touchmove", mine);
      window.removeEventListener("keydown", onKey);
      setRect(null);
    };
  }, [selector, actionSelector, cover]);
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
  // What the docked card and the tab bar cover on a phone, for the in-view check.
  const cover = useRef(0);
  const { rect, hasAction } = useTarget(here ? step.target : null, here ? (step.action?.target ?? null) : null, cover);
  const card = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(180);
  const [vw, vh] = useViewport();
  // The phone card sits 60 px above the bottom edge, over the tab bar.
  useEffect(() => {
    cover.current = cardH + 68;
  }, [cardH]);

  // On a phone, room at the bottom of the page while the tour runs, so a target
  // near the end (the run log) can still scroll up above the card.
  const phoneTour = running && vw < PHONE;
  useEffect(() => {
    if (!phoneTour) return;
    const body = document.body;
    const before = body.style.paddingBottom;
    body.style.paddingBottom = `${cardH + 68}px`;
    return () => {
      body.style.paddingBottom = before;
    };
  }, [phoneTour, cardH]);
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
  // A target scrolled out of view docks the card in the corner, so the card never leaves the screen with it.
  const visible = !!rect && rect.top + rect.height > 0 && rect.top < vh;
  let style: React.CSSProperties;
  if (phone || !rect || !visible) {
    style = phone
      ? { left: 8, right: 8, bottom: "calc(60px + env(safe-area-inset-bottom))" }
      : { right: 24, bottom: 24, width: CARD_W };
  } else {
    const below = rect.top + rect.height + PAD + 12;
    const above = rect.top - PAD - 12 - cardH;
    const fits = below + cardH < vh - 12 ? below : above > 12 ? above : vh - cardH - 24;
    const top = Math.max(12, Math.min(fits, vh - cardH - 12));
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
