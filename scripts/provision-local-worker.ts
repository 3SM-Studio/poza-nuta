import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import postgres from 'postgres';
import { assertLocalDatabaseTarget } from '../src/lib/local-target.ts';

const admin = parse(await readFile('.env.admin.local', 'utf8'));
const databaseUrl = assertLocalDatabaseTarget(admin.DIRECT_URL);
if (new URL(databaseUrl).port !== '55522') throw new Error('Persistent local development stack required.');
const previous = parse(await readFile('.env.worker.local', 'utf8'));
if (previous.IMPORT_WORKER_DATABASE_URL) {
  assertLocalDatabaseTarget(previous.IMPORT_WORKER_DATABASE_URL);
  console.log('Local worker already provisioned; unchanged.');
} else {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  const password = randomBytes(32).toString('hex');
  try {
    const [role] = await client`select exists(select 1 from pg_roles where rolname='kunestu_local_import') as present`;
    if (role.present) throw new Error('Local worker role exists without its managed credentials; refusing to overwrite.');
    await client.begin(async tx => {
      // Password is generated hex, never user input; utility DDL does not accept bind parameters.
      await tx.unsafe(`CREATE ROLE kunestu_local_import LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
      await tx`GRANT import_worker TO kunestu_local_import`;
    });
    const workerUrl = new URL(databaseUrl);
    workerUrl.username = 'kunestu_local_import'; workerUrl.password = password;
    await writeFile('.env.worker.local', '# Owned local Supabase only. Synthetic worker; no external imports.\n' +
      `IMPORT_WORKER_DATABASE_URL=${JSON.stringify(workerUrl.toString())}\nISING_CLIENT_ID="synthetic-local-only"\nISING_API_BASE_URL="http://127.0.0.1:55525"\n`, { mode: 0o600 });
    console.log('Provisioned separate local worker login; external catalog credentials absent.');
  } catch { throw new Error('Local worker provisioning failed safely; no credentials logged. Inspect local role state before retrying.'); }
  finally { await client.end(); }
}
