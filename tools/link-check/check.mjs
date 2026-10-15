#!/usr/bin/env node
// Usage: node tools/link-check/check.mjs [--out <file.md>] [--quiet]
// Writes a Markdown report. Default: tools/link-check/reports/link-check-<date>.md (git-ignored).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run, renderReport } from "./lib.mjs";

export const START_PAGES = [
  "https://www.limex.com/",
  "https://ziplime.limex.com/home",
  "https://builder.limex.com/",
  "https://launch.limex.com/smartdelta/",
  "https://qca.limex.pro/library",
];

const args = process.argv.slice(2);
const date = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
const outIndex = args.indexOf("--out");
const out = resolve(
  outIndex >= 0 ? args[outIndex + 1] : resolve(dirname(fileURLToPath(import.meta.url)), "reports", `link-check-${date}.md`),
);
const quiet = args.includes("--quiet");

const result = await run(START_PAGES, { log: quiet ? () => {} : (line) => console.error(line) });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, renderReport(result, { date }));

const count = (v) => result.findings.filter((f) => f.verdict === v).length;
console.log(`${result.checked} links checked, ${count("broken")} broken, ${count("soft404")} probably broken, ${result.placeholders.length} placeholder. Report: ${out}`);
