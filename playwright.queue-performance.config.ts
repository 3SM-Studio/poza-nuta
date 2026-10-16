import { assertNoCloudEnvironmentFiles } from "./scripts/local-environment-files.ts";

assertNoCloudEnvironmentFiles();

import { defineConfig, devices } from "@playwright/test";
import { assertLocalE2ETarget } from "./src/lib/local-target.ts";

assertLocalE2ETarget(process.env);

// Opt-in, disposable local PG17/Auth only. Never points at a deployed environment.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /(?:queue-drag-performance|theme-runtime)\.local\.spec\.ts/,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: ".playwright-p3-e2e",
  use: {
    ...devices["Desktop Chrome"],
    locale: "pl-PL",
    baseURL: "http://localhost:3105",
    trace: "off", // Avoid trace instrumentation in timing samples.
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command: "node_modules\\.bin\\next.cmd start --hostname localhost --port 3105",
    url: "http://localhost:3105",
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "ignore",
  },
});
