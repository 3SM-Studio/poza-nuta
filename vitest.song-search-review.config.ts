import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/postgres/songSearchAdversarial.review.test.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
