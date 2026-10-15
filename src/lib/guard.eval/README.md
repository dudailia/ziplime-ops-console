# Measuring the guard

The guard (`src/lib/guard.ts`) is a phrase list. This folder turns "it catches advice" into two numbers.

## The sets

- `must-catch.ts`: 300 texts it must flag. 150 investment advice, 100 promised returns, 50 mentions of other clients. Plain and hedged forms, questions, passive voice, British spelling, slang and typos.
- `must-pass.ts`: 300 support sentences it must not flag, about settings, refusals, the engine, the dry-run file, the forwarder and the console, written the way the console's own replies are. Many use the words the guard watches in an innocent sense: "sell order", "the endpoint returns 409", "we can't guarantee a fill", "your refusal rate will drop".
- `adversarial.ts`: 30 texts built to get past a phrase list: Cyrillic and Greek look-alike letters, zero-width characters, soft hyphens, line breaks and extra spaces inside a phrase, fullwidth letters, ligatures, combining accents, and words spelled out letter by letter. All must be caught, and the highlight must cover the trick in the original text.

All three were written by hand on 15 Oct 2026, before any tuning.

## Method, and what went wrong on the way

1. I wrote the two big sets, then `split.ts` shuffled each with a fixed seed (mulberry32, seed 20261015) and split it 70/30. I tuned the patterns looking only at the 70% split.
2. On the held-out 30% the first tuning looked excellent: 69 of 90 caught, 0 of 90 support sentences flagged.
3. It was overfitted. A pre-ship review wrote 30 ordinary support sentences against the new patterns ("Stock prices can fall as well as rise", "Swap your API key for the new one", "You'll be up and running in five minutes") and every one was blocked. My must-pass set simply never used the words the tuning had added, so it could not see this. Those 30 are in `review-pass.ts`, used for the second round of tuning, and not part of any reported rate.
4. I narrowed the patterns: a trade order now needs a market object (a ticker, a holding, stocks, bonds), bare idioms such as "entry point", "my advice" and "a different account" no longer count, and "should/could/may" predictions were dropped. The guard also normalizes other clients' names, so an accented or Cyrillic name is caught again (the first version of the normalization had stopped catching them).
5. Before the second measurement, a separate Claude session wrote `blind.ts` from a description of the console only, told not to read the code: 200 support sentences and 120 texts to catch. It never saw a pattern, and it was measured once, after the patterns were frozen.

## Results

| | main (12171b4) | First tuning | Now |
|---|---|---|---|
| **Blind set: support sentences flagged, of 200** | 3 (1.5%) | 11 (5.5%) | **0 (0%)** |
| **Blind set: caught, of 120** | 37 (30.8%) | 72 (60.0%) | **67 (55.8%)** |
| Blind, by kind: advice / returns / other clients | 8/60, 20/40, 9/20 | 33/60, 29/40, 10/20 | 29/60, 29/40, 9/20 |
| Held-out 30%: caught, of 90 | 30 (33.3%) | 69 (76.7%) | 65 (72.2%) |
| Held-out 30%: support flagged, of 90 | 1 (1.1%) | 0 | 0 |
| Review's 30 support sentences flagged | 0 | 30 | 0 |
| Adversarial caught, of 30 | 1 | 30 | 30 |
| Training 70%: caught / flagged, of 210 | 70 / 2 | 210 / 0 | 205 / 0 |

The blind row is the honest number: about 56% caught with nothing innocent blocked, on text from an author who never saw the patterns. The held-out split was looked at three times (before, after the first tuning, after the review), so it is no longer strictly held out. `guard.eval.test.ts` keeps the "now" column as floors.

## What this does not cover

- About 44% of the blind set's advice and promises still get through, most of all advice (29 of 60). The guard catches common phrasings, not intent.
- Both sets come from language models or from me, not from real client mail.
- English only. No sarcasm, no context across sentences, no images. Look-alike letters: Cyrillic and Greek only, the common ones.
- A phrase list is not a compliance review. A person reads and approves every reply; the guard makes their mistakes less likely, not impossible.
