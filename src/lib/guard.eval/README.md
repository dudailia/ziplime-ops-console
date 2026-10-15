# Measuring the guard

The guard (`src/lib/guard.ts`) is a phrase list. This folder turns "it catches advice" into two numbers.

## The sets

- `must-catch.ts`: 300 texts it must flag. 150 investment advice, 100 promised returns, 50 mentions of other clients. Plain and hedged forms, questions, passive voice, British spelling, slang and typos.
- `must-pass.ts`: 300 support sentences it must not flag, about settings, refusals, the engine, the dry-run file, the forwarder and the console, written the way the console's own replies are. Many use the words the guard watches in an innocent sense: "sell order", "the endpoint returns 409", "we can't guarantee a fill", "your refusal rate will drop".
- `adversarial.ts`: 30 texts built to get past a phrase list: Cyrillic and Greek look-alike letters, zero-width characters, soft hyphens, line breaks and extra spaces inside a phrase, fullwidth letters, ligatures, combining accents, and words spelled out letter by letter. All must be caught, and the highlight must cover the trick in the original text.

All three were written by hand on 15 Oct 2026, before any tuning.

## Method

`split.ts` shuffles each of the two big sets with a fixed seed (mulberry32, seed 20261015) and splits it 70/30. The patterns were tuned looking only at the 70% split's misses and false positives. The 30% split was measured twice: once before tuning, once after, and the patterns were not changed after the second look. The adversarial set is a specification, not a sample, so it was used for tuning.

| Held-out 30% | Before (main, 12171b4) | After |
|---|---|---|
| Caught, of 90 | 30 (33.3%) | 69 (76.7%) |
| Support sentences flagged, of 90 | 1 (1.1%) | 0 (0.0%) |
| Adversarial caught, of 30 | 1 | 30 |

On the 70% split the guard now catches 210 of 210 and flags 0 of 210, which says only that the patterns fit what they were tuned on. The held-out row is the honest one. `guard.eval.test.ts` keeps the held-out numbers as floors.

## What this does not cover

- I wrote both sides, so the sets share my habits. A held-out split from the same author is easier than text from real users. The real catch rate on client mail is probably lower than 76.7%.
- 21 of the 90 held-out phrasings still get through, for example "Isn't it time you sold your Apple shares?", "Apple is a strong buy in our view", "This will 10x your money" and "One customer had the same refusal on Monday".
- English only. No sarcasm, no context across sentences, no images.
- Look-alike letters: Cyrillic and Greek only, the common ones.
- A phrase list is not a compliance review. A person reads and approves every reply; the guard makes their mistakes less likely, not impossible.
