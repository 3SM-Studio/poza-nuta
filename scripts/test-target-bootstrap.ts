import { assertLocalDatabaseTarget, registerPostgresTestPort } from '../src/lib/local-target.ts';
// Parent harness verifies Docker ownership before supplying this port to its child.
if (process.env.KUNESTU_FAULT_TEST_PORT) {
  registerPostgresTestPort(Number(process.env.KUNESTU_FAULT_TEST_PORT));
  for (const key of ['DATABASE_URL', 'SLICE4_FAULT_DATABASE_URL']) {
    if (process.env[key]) assertLocalDatabaseTarget(process.env[key]);
  }
}
