import { assertNoCloudEnvironmentFiles } from "./scripts/local-environment-files.ts";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
assertNoCloudEnvironmentFiles();
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", env: { SONG_SEARCH_ENGINE: "unicode-v2" },
    include: ["tests/postgres/songSearchQuality.integration.test.ts", "tests/postgres/songSearchSqlApiUi.integration.test.tsx", "tests/postgres/songSearchAdversarial.review.test.ts"],
    setupFiles: ["./tests/vitest/setup.ts"], testTimeout: 180_000, hookTimeout: 180_000 },
});
