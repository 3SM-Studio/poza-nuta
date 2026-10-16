import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer, connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { databaseClientOptions } from '../../src/server/db-client-options.ts';

const [scenario, entry = 'esm'] = process.argv.slice(2);
// An explicit pristine package path supports reproducible before/after runs
// without mutating the installed dependency while tests are running.
const driverRoot = process.env.SLICE4_FAULT_DRIVER_ROOT;
const postgres = entry === 'cjs'
  ? createRequire(import.meta.url)(driverRoot ? resolve(driverRoot, 'cjs/src/index.js') : 'postgres')
  : (await import(driverRoot ? pathToFileURL(resolve(driverRoot, 'src/index.js')).href : 'postgres')).default;
const url = process.env.SLICE4_FAULT_DATABASE_URL;
assert.ok(url, 'Isolated fixture URL required');
const admin = postgres(url, { ...databaseClientOptions, max: 1, fetch_types: false, onnotice: () => {} });
let sql, proxy;
const pairs = new Set();
const key = `${scenario}-${entry}`;
const options = { ...databaseClientOptions, max: 1, max_pipeline: 1, fetch_types: false, onnotice: () => {},
  connection: { ...databaseClientOptions.connection, client_connection_check_interval: 100 } };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const outcome = promise => Promise.resolve(promise).then(value => ({ status: 'fulfilled', value }), error => ({ status: 'rejected', code: error.code }));
const rejectCode = result => {
  assert.equal(result.status, 'rejected');
  assert.ok(['CONNECTION_CLOSED', 'CONNECTION_DESTROYED', 'CONNECTION_ENDED', '57P01', 'ECONNRESET', 'EPIPE'].includes(result.code), `Unexpected failure code ${result.code}`);
};
const marker = (client, stage) => client`insert into public.driver_fault_probe (id) values (${`${key}:${stage}`})`;
const count = async stage => Number((await admin`select count(*)::integer as n from public.driver_fault_probe where id = ${`${key}:${stage}`}`)[0].n);
const event = (name, fields = {}) => process.stdout.write(JSON.stringify({ scenario, entry, event: name, ...fields }) + '\n');

async function waitForQuery(pid) {
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    const [row] = await admin`select wait_event from pg_stat_activity where pid = ${pid}`;
    if (row?.wait_event === 'PgSleep') return;
    await delay(10);
  }
  assert.fail('The actual backend did not enter the in-flight query');
}

async function waitForBackendExit(pid) {
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    if ((await admin`select 1 from pg_stat_activity where pid = ${pid}`).length === 0) return;
    await delay(10);
  }
  assert.fail('Disconnected backend must exit and roll back before retry');
}

async function startProxy() {
  const target = new URL(url);
  proxy = createServer(client => {
    const upstream = connect(Number(target.port), target.hostname);
    const pair = { client, upstream }; pairs.add(pair);
    const close = () => { pairs.delete(pair); client.destroy(); upstream.destroy(); };
    client.on('error', close); upstream.on('error', close);
    client.on('close', close); upstream.on('close', close);
    client.pipe(upstream).pipe(client);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  assert.ok(address && typeof address !== 'string');
  const proxied = new URL(url); proxied.hostname = '127.0.0.1'; proxied.port = String(address.port);
  return proxied.toString();
}

async function interruptInFlight(tcp = false, queued = false, endClient = false) {
  sql = postgres(tcp ? await startProxy() : url, options);
  const ready = deferred();
  let pending = [];
  const result = outcome(sql.begin(async tx => {
    await marker(tx, 'before');
    const [{ pid }] = await tx`select pg_backend_pid() as pid`;
    pending = [tx`select pg_sleep(30)`.execute()];
    if (queued) pending.push(marker(tx, 'queued').execute(), tx`select 1`.execute());
    const results = Promise.allSettled(pending);
    ready.resolve(pid);
    const settled = await results;
    assert.ok(settled.every(row => row.status === 'rejected'));
    await marker(tx, 'after');
  }));
  const pid = await ready.promise;
  await waitForQuery(pid);
  event('in_flight');
  if (endClient) await sql.end({ timeout: 0 });
  else if (tcp) for (const { client, upstream } of pairs) { client.resetAndDestroy(); upstream.destroy(); }
  else await admin`select pg_terminate_backend(${pid})`;
  event(endClient ? 'client_closed' : tcp ? 'tcp_reset' : 'backend_terminated');
  rejectCode(await result);
  for (const promise of pending) rejectCode(await outcome(promise));
  event('transaction_rejected');
  await delay(50); // Detect delayed nextWrite, after the awaited failure settled.
  await waitForBackendExit(pid);
  assert.equal(await count('before'), 0); assert.equal(await count('queued'), 0); assert.equal(await count('after'), 0);
  event('rollback_verified');
  if (endClient) { rejectCode(await outcome(sql`select 1`)); sql = postgres(url, options); }
  const [{ pid: healthy }] = await sql`select pg_backend_pid() as pid`;
  event('pool_reconnected');
  assert.notEqual(healthy, pid);
  await sql.begin(async tx => { event('retry_started'); await marker(tx, 'retry'); event('retry_written'); });
  assert.equal(await count('retry'), 1);
  event('healthy_pool_and_rollback_verified');
}

async function lateCallback(mode) {
  sql = postgres(url, options);
  const ready = deferred(), gate = deferred(), callbackDone = deferred();
  let late;
  const result = outcome(sql.begin(async tx => {
    const callback = async scope => {
      await marker(scope, 'before');
      ready.resolve((await scope`select pg_backend_pid() as pid`)[0].pid);
      await gate.promise;
      try {
        if (mode === 'query' || mode === 'savepoint') late = await outcome(marker(scope, 'escaped'));
        if (mode === 'rollback') throw new Error('Deliberate callback failure after disconnect');
      } finally { callbackDone.resolve(); }
    };
    return mode === 'savepoint' ? tx.savepoint(callback) : callback(tx);
  }));
  const pid = await ready.promise;
  await admin`select pg_terminate_backend(${pid})`;
  event('idle_backend_terminated');
  rejectCode(await result);
  event('idle_transaction_rejected');
  await sql.begin(async replacement => {
    const [{ id: before, pid: replacementPid }] = await replacement`select txid_current()::text as id, pg_backend_pid() as pid`;
    assert.notEqual(replacementPid, pid);
    await marker(replacement, 'replacement');
    gate.resolve(); await callbackDone.promise; await delay(50);
    if (late) rejectCode(late);
    const [{ id: after }] = await replacement`select txid_current()::text as id`;
    assert.equal(after, before, 'An old callback must not commit/rollback the replacement transaction');
  });
  assert.equal(await count('before'), 0); assert.equal(await count('escaped'), 0); assert.equal(await count('replacement'), 1);
  event('replacement_transaction_isolated');
}

async function reservedConnection(queued) {
  const closed = deferred();
  sql = postgres(url, { ...options, onclose: () => closed.resolve() });
  // Establish the pool before taking a reservation; the fault is injected into
  // an established connection, independently of cold-start type discovery.
  await sql`select 1`;
  const reserved = await sql.reserve();
  const [{ pid }] = await reserved`select pg_backend_pid() as pid`;
  event('reservation_established');
  let pending = [];
  if (queued) {
    pending = [reserved`select pg_sleep(30)`.execute(), reserved`select 1`.execute(), reserved`select 2`.execute()];
    pending = pending.map(outcome);
    await waitForQuery(pid);
  }
  await admin`select pg_terminate_backend(${pid})`;
  await closed.promise;
  event('reservation_closed');
  for (const promise of pending) rejectCode(await promise);
  rejectCode(await outcome(reserved`select 1`));
  rejectCode(await outcome(reserved`select 2`));
  reserved.release(); reserved.release();
  event('stale_reservation_rejected');
  assert.equal((await sql`select 1 as value`)[0].value, 1);
  event('released_pool_reconnected');
  const replacement = await sql.reserve();
  const [{ pid: healthy }] = await replacement`select pg_backend_pid() as pid`;
  assert.notEqual(healthy, pid);
  reserved.release(); // Must not release somebody else's new reservation.
  rejectCode(await outcome(reserved`select 3`));
  await marker(replacement, 'replacement'); replacement.release();
  assert.equal((await sql`select 1 as value`)[0].value, 1);
  event('stale_reservation_rejected_and_pool_healthy');
}

async function main() {
  try {
    const [{ version }] = await admin`select current_setting('server_version_num')::integer as version`;
    assert.ok(version >= 170000 && version < 180000);
    event('postgres17_verified');
    if (scenario === 'terminate') await interruptInFlight();
    else if (scenario === 'tcp') await interruptInFlight(true);
    else if (scenario === 'tcp-queued') await interruptInFlight(true, true);
    else if (scenario === 'queued') await interruptInFlight(false, true);
    else if (scenario === 'client-end') await interruptInFlight(false, false, true);
    else if (scenario.startsWith('late-')) await lateCallback(scenario.slice(5));
    else if (scenario === 'reserved' || scenario === 'reserved-queued') await reservedConnection(scenario === 'reserved-queued');
    else assert.fail('Unknown fault case');
    await delay(50);
    await sql.end({ timeout: 2 });
    event('PASS');
  } finally {
    event('cleanup_started');
    if (sql) await sql.end({ timeout: 2 });
    for (const { client, upstream } of pairs) { client.destroy(); upstream.destroy(); }
    if (proxy) await new Promise(resolve => proxy.close(resolve));
    await admin.end({ timeout: 2 });
    event('cleanup_finished');
  }
}
// Normal top-level promise handling; deliberately no process-wide error hooks.
main().catch(error => {
  process.stderr.write(`${error.name}: ${error.code ?? ''}\n${error.stack}\n`);
  process.exitCode = 1;
});
