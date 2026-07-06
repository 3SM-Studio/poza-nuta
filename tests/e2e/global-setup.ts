import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { chromium, type FullConfig } from "@playwright/test";

import {
  E2E_AUTH_STATE_PATH,
  E2E_BASE_URL,
  getMissingDashboardAuthEnv,
  getRequiredE2EEnv,
} from "./e2e-env";

export default async function globalSetup(_config: FullConfig) {
  const missingEnv = getMissingDashboardAuthEnv();

  if (missingEnv.length > 0) {
    console.warn(
      `[e2e] Dashboard auth setup skipped. Missing env: ${missingEnv.join(
        ", ",
      )}.`,
    );
    return;
  }

  await mkdir(dirname(E2E_AUTH_STATE_PATH), { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: E2E_BASE_URL });

  try {
    await page.goto("/sign-in");
    await page
      .locator("#operator-email")
      .fill(getRequiredE2EEnv("E2E_OPERATOR_EMAIL"));
    await page
      .locator("#operator-password")
      .fill(getRequiredE2EEnv("E2E_OPERATOR_PASSWORD"));
    await Promise.all([
      page.waitForURL(/\/dashboard(?:\/|\?|$)/, { timeout: 30_000 }),
      page.locator("form button[type='submit']").click(),
    ]);
    await page.context().storageState({ path: E2E_AUTH_STATE_PATH });
  } finally {
    await browser.close();
  }
}
