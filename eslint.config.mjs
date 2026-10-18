import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    // Generated local builds and retained diagnostics are not application source.
    ".next-*/**",
    ".artifacts/**",
    ".playwright*/**",
    "test-results/**",
    "dist/**",
    "data/**",
    "apps/**",
    "tests/**",
    "scripts/**",
  ]),
]);
