import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { loadAppEnv, parseAppEnv } from "../src/config/env.ts";

test("parseAppEnv applies shared defaults and trims optional values", () => {
  const env = parseAppEnv({
    SONG_INDEX_PATH: "custom/songs.json",
    KARAFUN_CSV_PATH: "custom/karafun.csv",
    KARAFUN_IMPORT_REPORT_PATH: "custom/report.json",
    ISING_CLIENT_ID: " public-client ",
    API_HOST: "0.0.0.0",
    API_PORT: "5432",
    API_ADMIN_TOKEN: " admin-token "
  });

  assert.equal(env.songIndexPath, resolve("custom/songs.json"));
  assert.equal(env.karafunCsvPath, resolve("custom/karafun.csv"));
  assert.equal(env.karafunImportReportPath, resolve("custom/report.json"));
  assert.equal(env.isingClientId, "public-client");
  assert.equal(env.apiHost, "0.0.0.0");
  assert.equal(env.apiPort, 5432);
  assert.equal(env.apiAdminToken, "admin-token");
});

test("loadAppEnv reads .env and lets process env override file values", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "env-test-"));
  try {
    const envPath = join(tempDir, ".env");
    await writeFile(envPath, ["SONG_INDEX_PATH=file-songs.json", "API_PORT=1111"].join("\n"), "utf8");

    const env = await loadAppEnv(envPath, { API_PORT: "2222" });

    assert.equal(env.songIndexPath, resolve("file-songs.json"));
    assert.equal(env.apiPort, 2222);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
