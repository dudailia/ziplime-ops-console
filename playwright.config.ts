import { defineConfig, devices } from "@playwright/test";

// One smoke test over the production build. Runs without ANTHROPIC_API_KEY,
// so it covers the "AI drafting is off" paths.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3200", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "npm run build && npx next start -p 3200",
    url: "http://localhost:3200",
    timeout: 240_000,
    reuseExistingServer: false,
    env: { ANTHROPIC_API_KEY: "" },
  },
});
