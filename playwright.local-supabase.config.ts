import { defineConfig, devices } from "@playwright/test";

const appPort = Number(process.env.LOCAL_E2E_APP_PORT ?? "3105");
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${appPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /public-event-session-identity\.local\.spec\.ts/,
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
    baseURL,
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command: `node_modules\\.bin\\next.cmd dev --hostname localhost --port ${appPort}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "ignore",
  },
});
