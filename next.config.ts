import type { NextConfig } from "next";

// The data mode is fixed at build time (PLAN.md 15.1, D2): a static build
// prerenders every page from the seed, a database build renders on request.
const CONSOLE_DATA_MODE = process.env.DATABASE_URL ? "database" : "static";

const nextConfig: NextConfig = {
  env: { CONSOLE_DATA_MODE },
  // Loaded from node_modules at runtime: PGlite ships WebAssembly and data files.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      // Seed dry-run files load as plain text: import.meta.glob(..., { query: "?raw" }).
      "*.jsonl": { condition: { query: "?raw" }, type: "text" },
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
