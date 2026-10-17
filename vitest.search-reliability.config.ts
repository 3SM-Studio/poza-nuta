import { assertNoCloudEnvironmentFiles } from "./scripts/local-environment-files.ts";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
assertNoCloudEnvironmentFiles();
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["tests/postgres/searchReliability.integration.test.ts", "tests/postgres/searchSecurity.integration.test.ts", "tests/postgres/searchIndexMigration.integration.test.ts", "tests/postgres/searchAdmission.integration.test.ts"], testTimeout: 900_000 },
});
