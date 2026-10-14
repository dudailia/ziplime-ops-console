import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The end-to-end ingest test (PLAN.md 15.8): a dev server on a fresh PGlite
// database, a generated ops password, the real seed generator and the real
// forwarder. Every run gets a new database. The values are made once and put
// in the environment, so the test workers (which load this file again) see
// the same ones.
process.env.E2E_DB_DIR ??= mkdtempSync(join(tmpdir(), "ziplime-e2e-db-"));
process.env.E2E_WORK_DIR ??= mkdtempSync(join(tmpdir(), "ziplime-e2e-run-"));
process.env.E2E_OPS_PASSWORD ??= randomBytes(16).toString("hex");

const PORT = 3300;

export default defineConfig({
  testDir: "e2e-ingest",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${PORT}`,
    httpCredentials: { username: "e2e", password: process.env.E2E_OPS_PASSWORD },
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    // The proxy answers 401 without credentials, which Playwright counts as up.
    url: `http://localhost:${PORT}/`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: { DATABASE_URL: `pglite:${process.env.E2E_DB_DIR}`, OPS_PASSWORD: process.env.E2E_OPS_PASSWORD, ANTHROPIC_API_KEY: "" },
  },
});
