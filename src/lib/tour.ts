// The 3-minute tour. Pure: the steps, a reducer and the saved form, so the
// walkthrough is testable without a browser. The overlay that draws it lives
// in components/tour.

export type TourStep = {
  id: string;
  /** Where the step happens. The tour navigates here when the step starts. */
  href: string;
  /** Page name for "this step is on ...". */
  page: string;
  /** CSS selector of the element to spotlight. */
  target: string;
  /** One sentence. */
  text: string;
  /** Optional: a button on the card that presses a real control on the page. */
  action?: { label: string; target: string };
};

// Line 50 of priya-growth.jsonl: the 11:09 TSLA refusal on 12 Oct.
export const TOUR: readonly TourStep[] = [
  {
    id: "refusal",
    href: "/portal?d=priya-growth&s=2026-10-12&l=50",
    page: "Dry-run review",
    target: '[data-tour="refusal"]',
    text: "Lime never saw this TSLA order: the engine refused it because TSLA isn't on the allowlist, and the fix names the exact setting to change.",
  },
  {
    id: "amber",
    href: "/ops",
    page: "Accounts",
    target: '[data-account="jonas-weber"]',
    text: "Jonas Weber is on watch, not in trouble: 11% of his orders were refused over the last 5 sessions, and the badge says why in words.",
  },
  {
    id: "guard",
    href: "/ops/inbox?t=T-1043",
    page: "Support inbox",
    target: '[data-tour="guard"]',
    text: "This draft promises returns, gives advice and names another client, so the guard highlights each phrase and Approve stays off until a person fixes it.",
  },
  {
    id: "intake",
    href: "/ops/intake?id=su-023",
    page: "Beta intake",
    target: '[data-tour="triage"]',
    text: "Rules marked will.tanaka high priority because they trade a funded account and asked about Trading Pod; approving creates their CRM account.",
    action: { label: "Approve will.tanaka", target: '[data-tour="approve-signup"]' },
  },
  {
    id: "rules",
    href: "/ops/automations",
    page: "Automations",
    target: '[data-tour="rules"]',
    text: "One run opens tickets for refusal streaks, notes Lime rejections and flags Harbor Lane for a live review that a person still decides.",
    action: { label: "Run rules now", target: '[data-tour="run-rules"]' },
  },
];

export type TourStatus = "idle" | "running" | "paused" | "done";
export type TourState = { status: TourStatus; step: number };

export type TourAction =
  | { type: "start" }
  | { type: "next" }
  | { type: "back" }
  | { type: "goto"; step: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "finish" };

export const TOUR_IDLE: TourState = { status: "idle", step: 0 };

const clamp = (n: number) => Math.max(0, Math.min(TOUR.length - 1, n));

export function tourReducer(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case "start":
      return { status: "running", step: 0 };
    case "next":
      if (state.status !== "running") return state;
      return state.step >= TOUR.length - 1 ? { status: "done", step: state.step } : { status: "running", step: state.step + 1 };
    case "back":
      if (state.status !== "running") return state;
      return { status: "running", step: clamp(state.step - 1) };
    case "goto":
      return { status: "running", step: clamp(action.step) };
    case "pause":
      return state.status === "running" ? { status: "paused", step: state.step } : state;
    case "resume":
      return state.status === "paused" ? { status: "running", step: state.step } : state;
    case "finish":
      return { status: "done", step: TOUR.length - 1 };
  }
}

/** What the front door's button should offer, given the saved state. */
export function tourCta(state: TourState): { label: string; action: TourAction } {
  if (state.status === "paused") return { label: `Resume the tour, step ${state.step + 1} of ${TOUR.length}`, action: { type: "resume" } };
  if (state.status === "done") return { label: "Take the tour again", action: { type: "start" } };
  return { label: "Take the 3-minute tour", action: { type: "start" } };
}

export const TOUR_KEY = "ziplime-ops-console:tour";

/** Reads a saved tour. Anything unexpected falls back to idle. */
export function parseTour(raw: string | null): TourState {
  if (!raw) return TOUR_IDLE;
  try {
    const v = JSON.parse(raw) as Partial<TourState>;
    const statuses: TourStatus[] = ["idle", "running", "paused", "done"];
    if (!statuses.includes(v.status as TourStatus) || typeof v.step !== "number" || !Number.isInteger(v.step)) return TOUR_IDLE;
    // A reload mid-tour comes back paused, so a page never opens with a spotlight the visitor didn't ask for.
    const status = v.status === "running" ? "paused" : (v.status as TourStatus);
    return { status, step: clamp(v.step) };
  } catch {
    return TOUR_IDLE;
  }
}

/** True when the current URL is the step's page (path and every query param the step sets). */
export function onStepPage(step: TourStep, pathname: string, search: URLSearchParams): boolean {
  const url = new URL(step.href, "http://x");
  if (url.pathname !== pathname) return false;
  for (const [k, v] of url.searchParams) if (search.get(k) !== v) return false;
  return true;
}
