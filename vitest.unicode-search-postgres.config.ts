import { assertNoCloudEnvironmentFiles } from "./scripts/local-environment-files.ts";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
assertNoCloudEnvironmentFiles();
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["tests/postgres/unicodeSongSearch.integration.test.ts", "tests/postgres/unicodeSearchTimeout.integration.test.ts"], testTimeout: 600_000 },
});
