// npm run bench:ingest: what one webhook batch costs as the stream grows.
// 40 batches of 500 lines into a fresh PGlite database, through storeBatch
// before 14 Oct 2026 (a copy in src/lib/ingest/__fixtures__) and through the
// current one. Prints the time for the batch that lands on 0, 10,000 and
// 19,500 stored lines.

import { describe, it } from "vitest";
import { freshDb } from "../src/lib/db/testing";
import { sha256Hex } from "../src/lib/ingest/signature";
import { storeBatch } from "../src/lib/ingest/store";
import { storeBatch as storeBatchBefore } from "../src/lib/ingest/__fixtures__/store.old";
import { rng, stream } from "../src/lib/ingest/__fixtures__/stream";

const BATCHES = 40;
const SIZE = 500;

async function run(name: string, store: typeof storeBatch) {
  const db = await freshDb();
  await db.exec(`insert into public.accounts (id, trader, email, plan, joined) values ('bench', 'Bench', 'bench@x.example', 'beta', '2026-07-01');
    insert into public.deployments (id, account_id, strategy, validate_orders) values ('bench', 'bench', 'Bench', true);`);
  const lines = stream(rng(1), BATCHES * SIZE, { bad: 0, repeats: 0 });
  const ms: number[] = [];
  for (let b = 0; b < BATCHES; b++) {
    const request = { file: "bench.jsonl", first_line: b * SIZE + 1, lines: lines.slice(b * SIZE, (b + 1) * SIZE) };
    const bodySha = sha256Hex(JSON.stringify(request));
    const t0 = performance.now();
    await db.tx((sql) => store(sql, { deploymentId: "bench", batchId: `00000000-0000-4000-8000-${String(b).padStart(12, "0")}`, bodySha, request, actor: "bench", requestId: null }));
    ms.push(performance.now() - t0);
  }
  await db.close();
  const at = (stored: number) => Math.round(ms[stored / SIZE]);
  console.log(`${name}: ${at(0)} ms at 0 stored lines, ${at(10_000)} ms at 10,000, ${at(19_500)} ms at 19,500 (total ${Math.round(ms.reduce((a, b) => a + b))} ms)`);
}

describe.runIf(process.env.BENCH === "ingest")("ingest benchmark", () => {
  it("before and after", async () => {
    await run("before", storeBatchBefore);
    await run("after ", storeBatch);
  });
});
