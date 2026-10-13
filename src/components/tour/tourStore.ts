"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { onStepPage, parseTour, TOUR, TOUR_IDLE, TOUR_KEY, tourReducer, type TourAction, type TourState } from "@/lib/tour";

// One tour per tab, saved so it can be resumed. A module store rather than
// context: the front door, the rail and the overlay all read it.
let state: TourState = TOUR_IDLE;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  try {
    state = parseTour(window.localStorage.getItem(TOUR_KEY));
  } catch {}
}

function getTour(): TourState {
  load();
  return state;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function dispatchTour(action: TourAction): TourState {
  load();
  const next = tourReducer(state, action);
  if (next === state) return state;
  state = next;
  try {
    window.localStorage.setItem(TOUR_KEY, JSON.stringify(state));
  } catch {}
  for (const l of listeners) l();
  return state;
}

export function useTourState(): TourState {
  return useSyncExternalStore(subscribe, getTour, () => TOUR_IDLE);
}

/** Tour actions that also take the visitor to the step's page. */
export function useTour() {
  const router = useRouter();
  const tour = useTourState();
  const act = (action: TourAction) => {
    const next = dispatchTour(action);
    if (next.status !== "running") return;
    const step = TOUR[next.step];
    if (!onStepPage(step, window.location.pathname, new URLSearchParams(window.location.search))) router.push(step.href, { scroll: false });
  };
  return { tour, act };
}
