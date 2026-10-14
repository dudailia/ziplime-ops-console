// Runs after `next build`: every class globals.css defines must be in the CSS
// the build ships. Guards against a stale build cache serving old CSS (see
// next.config.ts), which once shipped a page with half its styles missing.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const classes = new Set([...source.matchAll(/\.([a-z][a-z0-9-]*)(?=[\s.:,{[>)])/g)].map((m) => m[1]));

const dir = join(root, ".next/static");
const css = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walk(join(d, e.name));
    else if (e.name.endsWith(".css")) css.push(readFileSync(join(d, e.name), "utf8"));
  }
};
walk(dir);
const built = css.join("\n");

const missing = [...classes].filter((c) => !new RegExp(`\\.${c}(?![a-z0-9-])`).test(built));
if (missing.length) {
  console.error(`check-css: the build's CSS is missing ${missing.length} class(es) from globals.css: ${missing.join(", ")}`);
  console.error("check-css: a stale build cache is the usual cause. Delete .next and build again.");
  process.exit(1);
}
console.log(`check-css: all ${classes.size} globals.css classes are in the build.`);
