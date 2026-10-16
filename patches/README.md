# Postgres.js 3.4.9 fault recovery patch

`postgres@3.4.9.patch` is registered in `pnpm-workspace.yaml`; the lockfile
records its content hash. `package.json` pins exactly 3.4.9. Install with
`pnpm install --frozen-lockfile`. No application API, schema, timeout or pool
size is changed. No global exception/rejection handler is installed.

## Upstream review (2026-10-16)

The npm `latest` dist-tag and the official [latest stable
release](https://github.com/porsager/postgres/releases/tag/v3.4.9) are 3.4.9.
There is no newer stable release containing these fixes at review time.

- [Issue 1208](https://github.com/porsager/postgres/issues/1208) reports a
  deferred `nextWrite` after socket close. Our pristine Node child process
  reproduces the same `connection.js:255` null-socket stack on PostgreSQL 17.
- [PR 1209](https://github.com/porsager/postgres/pull/1209), open/unmerged,
  reviewed head `a2588b3073b5bd125f0fb3b419bdc9f2e8524291`: reject pending
  work on a null socket, clear the deferred write and return false.
- [PR 1215](https://github.com/porsager/postgres/pull/1215), open/unmerged,
  reviewed head `18cffe016927e01481b9e746587da789f4260a4c`: clear protocol
  result/error state after close, reject private transaction queues, and refuse
  later SQL through the disconnected transaction scope.
- [Issue 1248](https://github.com/porsager/postgres/issues/1248) explains why
  `Promise.race` rejecting `begin` does not cancel its callback: subsequent SQL,
  COMMIT or ROLLBACK can reach a reused connection. Our PG17 tests reproduce
  a successful stale INSERT and a changed replacement transaction ID before
  patching. Its later comment also describes internal type-discovery failures
  behind PgBouncer; this change does not claim PgBouncer fault coverage.

## Scope and additional evidence

The patch applies the two reviewed fixes to all three shipped source variants:
ESM (`src`), CommonJS (`cjs/src`) and workerd (`cf/src`). Only `connection.js`
and `index.js` change in each variant. ESM and CommonJS execute against PG17;
workerd receives identical logic but has no runtime verification in this app.

Two small additions follow from local reproductions:

1. `closed(hadError)` drains pending work even after a prior socket `error`.
   Between `error` and `close`, the rejected callback can queue ROLLBACK into
   `sent`. The upstream close guard skips it when `hadError` is true. The TCP
   reset reproduction showed one stale entry surviving reconnect: the first
   new query succeeded but the next BEGIN hung while PostgreSQL was idle.
   Rejecting that queue at close prevents both the hang and stale execution.
2. A reserved handle owns one reservation, not the mutable connection object
   forever. Close rejects its private queue. Its stale queries reject; late or
   repeated `release()` cannot reopen a closed connection or release another
   caller's replacement reservation. An explicit release clears its own close
   callback. The stale-reservation regressions failed on pristine 3.4.9.

The original connection error still reaches the caller. Pending queries reject
instead of disappearing, and a disconnected scope rejects callback SQL,
savepoints and its automatic COMMIT/ROLLBACK before sending anything. There
are no retries of failed business transactions inside the driver patch.

## Verification and maintenance

Run `pnpm test:postgres:public-event-session-identity` on a Docker-capable host.
It includes raw Node OS children for 11 fault scenarios in both module modes,
plus the existing application suites. A child timeout, signal, nonzero exit or
late uncaught exception fails the parent. The actual merge fault/race test also
runs in a child Vitest process, preserving all original assertions.

Raw workers deliberately disable type discovery to isolate the transport
protocol; application integrations and browser smoke use the normal driver
configuration. Reservations are taken from an established pool and after a
normal reconnect query, independently of cold-reservation initialization.
These fixtures are not changes to production client options.

For a pristine A/B reproduction, extract the published 3.4.9 package outside
`node_modules`, then set `SLICE4_FAULT_DRIVER_ROOT` to its absolute directory
and `SLICE4_FAULT_ARTIFACT_PREFIX` to a separate local log prefix before running
the driver integration file. Do not replace installed packages during a run.
No fixture credentials belong in command arguments or logs.

Remove the patch only after reviewing an official stable replacement for all
five behaviors above and passing the fault suite, application PG17 gate,
browser linking/merge smoke and normal project checks against that release.
Do not merely delete the patch when an upstream PR merges. Until removal,
dependency updates must preserve the exact patch registration and lock hash.

Recovery details and results are recorded in
[the Slice 4 handoff](../docs/features/participant-model-slice-4.md).
