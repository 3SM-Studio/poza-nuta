import assert from "node:assert/strict";
import { afterAll, beforeAll, test } from "vitest";
import { createPostgresTestClient, removePostgresTestHarness, startPostgresTestHarness, type PostgresTestHarness } from "./postgresTestHarness";
import { runFaultProcess } from "./faultProcessHarness";

let harness: PostgresTestHarness;
let databaseUrl: string;
beforeAll(async () => {
  harness = await startPostgresTestHarness("pozanuta-driver-recovery");
  const admin = createPostgresTestClient(harness, "postgres");
  try {
    const [{ version }] = await admin`select current_setting('server_version_num')::integer as version`;
    assert.ok(version >= 170000 && version < 180000);
    await admin`create table public.driver_fault_probe (id text primary key)`;
  } finally { await admin.end({ timeout: 5 }); }
  const url = new URL("postgresql://127.0.0.1/postgres");
  url.port = String(harness.port); url.username = "postgres"; url.password = harness.password;
  databaseUrl = url.toString();
});
afterAll(async () => { if (harness) await removePostgresTestHarness(harness.containerName); });

for (const entry of ["esm", "cjs"]) {
  for (const scenario of ["terminate", "tcp", "tcp-queued", "queued", "client-end", "late-query", "late-commit", "late-rollback", "late-savepoint", "reserved", "reserved-queued"]) {
    test(`postgres17 driver ${entry}: ${scenario} survives without transaction escape`, async () => {
      const artifact = `${process.env.SLICE4_FAULT_ARTIFACT_PREFIX ?? "slice4-recovery"}-${entry}-${scenario}.log`;
      const child = await runFaultProcess({
        args: ["--experimental-strip-types", "tests/postgres/postgresDriverFault.worker.mjs", scenario, entry],
        env: { SLICE4_FAULT_DATABASE_URL: databaseUrl }, timeoutMs: 15_000, artifact,
      });
      assert.equal(child.timedOut, false, `Driver worker hung; see .artifacts/${artifact}`);
      assert.equal(child.signal, null, `Driver worker signalled; see .artifacts/${artifact}`);
      assert.equal(child.exitCode, 0, `Driver worker failed; see .artifacts/${artifact}`);
      assert.match(child.output, /"event":"PASS"/);
      assert.doesNotMatch(child.output, /uncaught|unhandled|TypeError/i);
    }, 20_000);
  }
}
