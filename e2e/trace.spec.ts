import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { expect, test } from "@playwright/test";

// What the build traces into the server output, from the .nft.json files the
// webServer's `npm run build` just wrote. Outside node_modules and .next, only
// these may ship: a path the tracer can't resolve pulls in the whole project
// (src/lib/db/migrate.ts once did: README, PLAN.md, every screenshot, tests).
const ALLOWED = [/^src\/app\//, /^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/, /^docs\/HOW_I_BUILT_THIS\.md$/];

function traces(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? traces(join(dir, e.name)) : e.name.endsWith(".nft.json") ? [join(dir, e.name)] : [],
  );
}

test("the server output traces only the files the app reads", async ({ isMobile }) => {
  test.skip(isMobile, "one build, checked once");
  const root = process.cwd();
  const shipped = new Set<string>();
  for (const f of traces(join(root, ".next", "server"))) {
    for (const file of JSON.parse(readFileSync(f, "utf8")).files as string[]) {
      const path = relative(root, normalize(join(dirname(f), file)));
      if (!path.startsWith("node_modules/") && !path.startsWith(".next/")) shipped.add(path);
    }
  }
  expect(shipped.size).toBeGreaterThan(0);
  expect([...shipped].filter((p) => !ALLOWED.some((a) => a.test(p))).sort()).toEqual([]);
});
