import { assertNoCloudEnvironmentFiles } from "./scripts/local-environment-files.ts";

assertNoCloudEnvironmentFiles();

import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "tests/postgres/songSearchQuality.integration.test.ts",
      "tests/postgres/songSearchSqlApiUi.integration.test.tsx",
    ],
    setupFiles: ["./tests/vitest/setup.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
