import type { NextConfig } from "next";

// The data mode is fixed at build time (PLAN.md 15.1, D2): a static build
// prerenders every page from the seed, a database build renders on request.
const CONSOLE_DATA_MODE = process.env.DATABASE_URL ? "database" : "static";

// Production only: next dev evaluates code with eval() for fast refresh and
// React's debugging, which this policy would block.
const CSP = [
  "default-src 'self'",
  // 'unsafe-inline' because Next's App Router bootstraps with inline scripts
  // (self.__next_f.push(...)) and the theme script in layout.tsx is inline.
  // A nonce would make every page dynamic, and the static demo prerenders.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  env: { CONSOLE_DATA_MODE },
  // Loaded from node_modules at runtime: PGlite ships WebAssembly and data files.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  cacheComponents: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(process.env.NODE_ENV === "production" ? [{ key: "Content-Security-Policy", value: CSP }] : []),
        ],
      },
    ];
  },
  partialPrefetching: true,
  // Turbopack's build cache (on by default in 16.4) shipped the previous
  // globals.css on the first build after an edit: the Tailwind loader's output
  // wasn't invalidated. Reproduced with a probe rule; off, every build is fresh.
  // scripts/check-css.mjs fails the build if it ever happens again.
  experimental: { turbopackFileSystemCacheForBuild: false },
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
