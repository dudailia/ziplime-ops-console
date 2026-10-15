// The guard's two numbers: how much of the must-catch set it catches, and how
// much of the must-pass set it wrongly flags.

import { guard } from "../guard";
import { ADVERSARIAL } from "./adversarial";
import { CATCH, PASS } from "./split";

type Guard = typeof guard;

export type Score = { caught: number; total: number; missed: string[] };

export function catchRate(texts: readonly (readonly [string, string])[], g: Guard = guard): Score {
  const missed = texts.filter(([t]) => g(t).ok).map(([t]) => t);
  return { caught: texts.length - missed.length, total: texts.length, missed };
}

export function falsePositives(texts: readonly string[], g: Guard = guard): Score {
  const flagged = texts.filter((t) => !g(t).ok);
  return { caught: flagged.length, total: texts.length, missed: flagged };
}

export function report(g: Guard = guard) {
  return {
    trainCatch: catchRate(CATCH.train, g),
    testCatch: catchRate(CATCH.test, g),
    trainFalse: falsePositives(PASS.train, g),
    testFalse: falsePositives(PASS.test, g),
    adversarial: catchRate(ADVERSARIAL.map((a) => [a.text, a.category] as const), g),
  };
}

export const pct = (s: Score) => `${s.caught}/${s.total} (${((100 * s.caught) / s.total).toFixed(1)}%)`;
