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
      "tests/postgres/publicEventSessionIdentity.integration.test.ts",
      "tests/postgres/participantIdentity.integration.test.ts",
      "tests/postgres/participantSongDiscovery.integration.test.ts",
    ],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
