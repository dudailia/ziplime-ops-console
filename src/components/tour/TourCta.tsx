"use client";

import { tourCta, TOUR } from "@/lib/tour";
import { useTour } from "./tourStore";

/** The front door's main button: start, resume or retake the tour. */
export function TourCta() {
  const { tour, act } = useTour();
  const cta = tourCta(tour);
  return (
    <span className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        data-testid="tour-start"
        onClick={() => act(cta.action)}
        className="press t-btn inline-flex items-center gap-2.5 bg-accent px-[22px] py-[14px] text-[14px] text-on-accent transition-[background-color,transform] duration-150 hover:bg-ink"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <path d="M3.5 2.2v9.6L11.5 7z" fill="currentColor" />
        </svg>
        {cta.label}
      </button>
      {tour.status === "paused" && (
        <button type="button" className="text-[13px] text-ink-2 underline hover:text-ink" onClick={() => act({ type: "start" })}>
          Start over
        </button>
      )}
      <span className="sr-only">{TOUR.length} steps, one sentence each.</span>
    </span>
  );
}
