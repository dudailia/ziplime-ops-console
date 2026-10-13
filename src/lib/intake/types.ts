// A Beta signup, mirroring the row limex.com's early-access form posts to
// /api/leads (live bundle checked 2026-10-13 15:30 ET), plus one proposed field.

export const FORM = {
  trade: { question: "What do you trade?", options: ["Stocks", "Options", "Futures", "Crypto"] },
  style: { question: "How do you trade?", options: ["Day trading", "Swing", "Part-time", "Just starting"] },
  funded: { question: "Funded / prop account?", options: ["Trading one now", "Working toward it", "Not my thing"] },
  pain: {
    question: "Biggest frustrations today?",
    options: ["Manual entry", "No real insight", "My own psychology", "Price", "Privacy", "Other"],
  },
} as const;

export const POD_TOGGLE = "I have a track record and want to hear about Trading Pod. (invite-only)";

export type Asset = (typeof FORM.trade.options)[number];

export type Signup = {
  id: string;
  email: string;
  ts: string;
  page: string;
  trade: string[];
  style: string[];
  funded: string[];
  pain: string[];
  wantsPod: boolean;
  /** Proposed field, not on limex.com today. */
  note?: string;
};

/** True when the optional second step was left empty. */
export function skippedStepTwo(s: Signup): boolean {
  return s.trade.length + s.style.length + s.funded.length + s.pain.length === 0 && !s.wantsPod;
}
