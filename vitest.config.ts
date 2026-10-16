import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Server modules import "server-only"; tests load them directly.
      "server-only": fileURLToPath(new URL("./src/lib/test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Six files each start an in-memory Postgres (PGlite, WASM) and migrate it in
    // beforeAll: 2 s alone, past the 10 s default when every file runs at once on
    // a loaded machine. A slow setup is not a failure; a wrong result still is.
    hookTimeout: 60_000,
  },
});
