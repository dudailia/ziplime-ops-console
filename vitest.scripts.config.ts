import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// One-off database tasks (npm run db:migrate, npm run db:seed). vitest is the
// TypeScript runner here, so the tasks run the same tested code the app uses
// with no extra tool.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["scripts/**/*.run.ts"], environment: "node", testTimeout: 300_000, reporters: ["verbose"] },
});
