// Property-test settings shared by every *.fuzz.test.ts. A fixed seed in
// npm test and CI, so a failure is reproducible; npm run test:full sets
// FUZZ_RANDOM=1 for a fresh seed each run and prints it. FUZZ_SEED=<n>
// replays one.

const fixed = 20261015;
const fromEnv = process.env.FUZZ_SEED ? Number(process.env.FUZZ_SEED) : null;
export const FUZZ_SEED = fromEnv ?? (process.env.FUZZ_RANDOM ? Math.floor(Math.random() * 2 ** 31) : fixed);
if (FUZZ_SEED !== fixed) console.log(`[fuzz] seed ${FUZZ_SEED} (replay with FUZZ_SEED=${FUZZ_SEED})`);

export const fuzz = (numRuns = 1000) => ({ seed: FUZZ_SEED, numRuns });
