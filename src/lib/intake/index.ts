import signupsJson from "../../../data/seed/signups.json";
import type { Account } from "../seed";
import type { Signup } from "./types";

export const SIGNUPS = signupsJson.signups as Signup[];

export function signupById(signups: readonly Signup[], id: string): Signup | undefined {
  return signups.find((s) => s.id === id);
}

/** "maya.chen@example.com" -> "Maya Chen". The form collects no name. */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0].replace(/[._-]+/g, " ").replace(/\d+/g, "").trim();
  return local
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length === 1 ? `${w.toUpperCase()}.` : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

/** The CRM account an approved signup becomes: Beta, no Lime account, no deployments. */
export function accountFromSignup(s: Signup, taken: readonly string[], at: string): Account {
  const base = `intake-${s.email.split("@")[0].replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return {
    id,
    trader: nameFromEmail(s.email),
    company: null,
    email: s.email,
    accountNumber: "",
    plan: "beta",
    joined: at.slice(0, 10),
    fromIntake: s.id,
  };
}
