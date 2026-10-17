import { assertNoCloudEnvironmentFiles } from "./scripts/local-environment-files.ts";

assertNoCloudEnvironmentFiles();

import { defineConfig, devices } from "@playwright/test";
import { assertLocalE2ETarget } from "./src/lib/local-target.ts";

assertLocalE2ETarget(process.env);

const appPort = Number(process.env.LOCAL_E2E_APP_PORT ?? "3105");
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${appPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /(?:public-event-session-identity|theme-runtime|queue-collaboration)\.local\.spec\.ts/,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: ".playwright-p3-e2e",
  use: {
    ...devices["Desktop Chrome"],
    locale: "pl-PL",
    baseURL,
    trace: process.env.LOCAL_E2E_TRACE === "on" ? "on" : "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command: `node_modules\\.bin\\next.cmd ${process.env.LOCAL_E2E_OPTIMIZED === "1" ? "start" : "dev"} --hostname localhost --port ${appPort}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "ignore",
  },
});
