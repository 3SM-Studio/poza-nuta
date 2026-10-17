# ADR: bounded catalog-search admission across instances

Status: accepted for local implementation; production rollout requires approval.

## Evidence

The baseline Unicode fuzzy plan scans/scores broad document sets. Expression GiST
plus exact score/ID tie breakers removed 16/20 cancellations in a 20-connection
synthetic workload on the 16-logical-CPU workstation. That was insufficient evidence
for smaller resources. A subsequent 2-CPU-quota probe with a larger index signature
still cancelled 20/20 distinct simultaneous searches. Query speed alone cannot
protect a shared database against arbitrary concurrent CPU demand.

## Decision

Retain the measured 256-byte signature expression index. Coalesce identical
in-flight catalog reads per database/engine/query/cursor. Bound distinct pending
keys to 128 per process; duplicates may join at capacity, new keys receive an
honest existing SERVICE_UNAVAILABLE/503 response. Completed results are not cached.

Both search engines use `withSongSearchAdmission`. Two **transaction-level**
advisory slots in the database's two-integer keyspace, namespace `0x4b535243`,
cap admitted searches across all application instances using this code. These
keys do not overlap the existing single-bigint participant/presence/setup keys.
The query calls `pg_catalog.pg_try_advisory_xact_lock` through Drizzle. CASE stops
after the first available slot; a request cannot acquire both by evaluating a
two-row LIMIT expression. No schema objects, privileged functions or new service
are needed for admission.

If neither slot is available, the short transaction commits and releases its
connection. Bounded application-side jitter/backoff happens outside the transaction.
The 6s admission budget is monotonic; an expired pool checkout cannot start the
expensive query. Budget expiry returns 503 and a safe capacity diagnostic. This is
not a promise of a hard 6s HTTP deadline: an in-flight pool/network operation must
return before its elapsed time is checked. Existing connection/statement limits
continue to apply. No database connection is intentionally held during backoff.

On admission, existing SQL executes in the same transaction, with the unchanged
2s Unicode statement timeout. The slot releases on commit, rollback or connection
loss. Actual query errors are propagated; only a known negative permit result is
retried. There is no automatic retry of expensive cancelled queries and no empty
success/fallback response hiding failures. Session/Auth/RBAC checks remain before
catalog access and write-side permissions/capacity checks remain independent.

## Consequences and limits

- This deliberately trades excess parallelism for bounded database work. Large
  bursts may wait or receive explicit capacity errors; search is not a FIFO or
  starvation-proof scheduler under continuous overload.
- A slow/abusive client can still consume shared capacity. Existing device/network
  rate limits are defense in depth; distributed edge protection remains a separate
  production configuration review. No WAF setting is changed here.
- Original/old deployed code, imports, category aggregation and unrelated SQL do
  not participate in these slots. The limiter does not cap all database CPU or
  physical connections, and it cannot replace a measured hosted-resource preflight.
- Catalog discovery has a separate lazy 60s cache, with per-process deduplication.
  TTL, not an in-process import callback, guarantees bounded cross-process staleness.
- The slots are implementation-level resource admission for the shared public
  catalog. They are unrelated to singer fairness, event ordering or the 2/2 limit.
  Queue writes and Realtime snapshots acquire no search slot.
- The runtime database role must be permitted to execute the built-in two-integer
  transaction advisory-lock function. Verify that read-only before production;
  do not add a SECURITY DEFINER wrapper or grant permissions automatically.

## Alternatives rejected

Raising the SQL timeout conceals resource contention. A per-instance semaphore
cannot bound work across Vercel instances. A Redis/worker/extra table would add an
unnecessary operational dependency. Waiting in a SQL advisory-lock call would hold
a connection and consume the statement timeout. Session-level advisory locks are
unsafe for transaction pooling. Sampling/truncating fuzzy matches or arbitrary
KNN ties would weaken relevance and pagination.

## Verification

Owned PostgreSQL 17 tests verify two concurrent callbacks with eight connections,
an independent pool holding both permits, bounded rejection without executing the
search callback, zero lock-waiting backends after rejection, rollback/release and
recovery. Load evidence must report capacity rejections separately from SQL
cancellations; neither is a passing response for the representative final-service
workload. Baseline/uncollapsed control overload is recorded, not suppressed.
