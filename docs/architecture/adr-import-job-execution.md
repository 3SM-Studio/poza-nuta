# ADR: Import Job Execution

Status: Accepted.
Date: 2026-07-16.
Scope: Ticket 12 architecture decision for import execution, worker recovery,
private KaraFun artifacts and scheduling boundaries.

This ADR does not implement a worker, provision infrastructure, create a
migration or authorize a database or production change. Ticket 13 implements
the durable import worker and its migration. Ticket 14 implements retention
cleanup and its operational evidence.

Related documents:

- [Platform Admin Dashboard Contract](../features/platform-admin-dashboard.md)
- [Platform Product Model](../product/platform-product-model.md)
- [Multi-Tenant Karaoke Platform ADR](./adr-multi-tenant-karaoke-platform.md)
- [Import Job Status Expansion Runbook](../migrations/0016-import-job-status-expand.md)
- [Import Job Data Foundation Expand Runbook](../migrations/0017-import-job-data-foundation-expand.md)
- [Import Job Data Foundation Contract Runbook](../migrations/0018-import-job-data-foundation-contract.md)

## Context

Migration `0018` finalizes the current `import_jobs` data contract. The table
represents `queued`, `running`, `succeeded`, `failed` and `cancelled` jobs. It
stores source, mode, initiator, lifecycle timestamps, progress counters, safe
errors, cancellation metadata and private-artifact metadata. A partial unique
index permits at most one `queued` or `running` job for each source.

The current execution paths are not durable workers:

- iSing runs through a direct operational CLI. A write import creates a job
  immediately in `running`, performs batch song upserts and marks the job
  `succeeded` or `failed`;
- KaraFun runs through a separate CSV CLI and does not create or update a
  durable import job;
- there is no job queue service, atomic claim, worker process, scheduler,
  heartbeat, lease or stale-job recovery;
- batch upserts commit incrementally, so completed batches can survive a
  process crash before the job reaches a terminal status.

The accepted product contract requires imports to execute outside a Vercel
request lifetime, remain non-destructive and idempotent, support cooperative
cancellation and recover without creating a second active job for the same
source.

## Decision

### Execution Architecture

PostgreSQL `import_jobs` is the durable queue and source of truth for import
state. A separate, supervised Node.js process claims and executes jobs. The
worker runs in a provider-neutral container runtime that supports a
long-running process, health monitoring and graceful shutdown.

The worker does not execute inside a Vercel request, Route Handler,
fire-and-forget callback or request-lifetime extension. It polls PostgreSQL for
eligible jobs, so a scheduler is not required to execute imports.

Supabase Cron may be evaluated in Ticket 14 only as a trigger for short,
bounded cleanup work. It is not the import worker and does not own import
durability.

KaraFun source files use a private Supabase Storage bucket. The server-side
upload flow generates `sourceArtifactId` as a UUID. In the first version, the
storage object key is derived deterministically from that UUID, for example
`karafun/{sourceArtifactId}/source.csv`.

`import_jobs`, audit records and diagnostics store neither the bucket path nor
a signed URL or provider payload. If a signed URL is needed, server code creates
it with a short lifetime and never persists it. Only the server-side upload flow
and the worker can access the private bucket. The `anon` and `authenticated`
roles and browser code receive no direct bucket access. Artifact retention and
physical deletion remain in Ticket 14.

The container hosting provider remains a deployment decision. Any selected
runtime must support the execution, security and operational requirements in
this ADR.

### Claim And Recovery

Claiming uses `SELECT ... FOR UPDATE SKIP LOCKED` to choose an eligible job and
an atomic conditional `UPDATE` to acquire it. The update succeeds only when the
job still has the expected state and claim eligibility.

Ticket 13 uses the following claim contract:

- `claim_token` is a new random UUID for every successful claim or reclaim;
- `attempt_count` increments on every successful claim, including the initial
  claim;
- a job may be claimed at most three times in total;
- `lease_expires_at` is set 60 seconds after a successful claim;
- `heartbeat_at` is refreshed every 15 seconds while work is active;
- an expired `running` job may be reclaimed by another worker with a new token;
- reclaim preserves the job ID, original `createdAt` and original `startedAt`;
- attempt exhaustion is handled by a separate recovery transaction acting as a
  system actor;
- retry never creates a replacement job;
- `import_jobs_one_active_per_source_idx` remains the final protection against
  two active jobs for one source.

`next_attempt_at` is not required in the first worker version. Short retryable
infrastructure failures use bounded backoff inside the active lease. Crash
recovery begins only after the lease expires.

Every claim-bound mutation includes both job ID and `claim_token`. A worker owns
a job only while the token matches and its lease has not expired. A worker that
lost its lease cannot update progress or terminalize the job, even when no
other worker has reclaimed it yet.

Recovery locks the job row and rechecks its status, lease expiry and
`attempt_count`. An expired `running` job below the attempt limit can be
reclaimed by the next claim transaction. An expired `running` job at the limit
is atomically changed to `failed` by the recovery transaction with a stable,
safe error code and an `import.fail` audit record in the same transaction.

### State Machine

```text
operator enqueue       -> queued
worker claim           queued -> running
stale reclaim          running -> running (new claim token)
worker complete        running -> succeeded
worker fail            running -> failed
operator cancel        queued -> cancelled
operator request       running + cancellation request
worker acknowledges    running -> cancelled
```

The following rules are binding:

- enqueue creates a new `queued` job;
- only a worker changes `queued` to `running`;
- finalization requires the current claim token;
- `complete` checks for a cancellation request in the same transaction before
  changing the job to `succeeded`;
- a running worker checks cancellation between bounded batches;
- already committed song upserts remain committed after cancellation or crash;
- terminal jobs never return to `queued` or `running`;
- `succeeded`, `failed` and `cancelled` are immutable except for later retention
  operations explicitly defined by Ticket 14.

### Authorization

`platform_owner` and `platform_admin` may enqueue iSing imports, enqueue
KaraFun imports when the artifact flow exists, and request cancellation.
`support` remains read-only.

Actor identity comes only from a verified server-side session, an active and
unsuspended local operator profile, and an active platform membership. Enqueue
and cancellation recheck actor eligibility inside the mutation transaction.
Client-supplied actor IDs or roles are never trusted.

The worker uses a separate, server-only infrastructure identity. It does not
use the `anon` or `authenticated` database roles, a browser session or an
operator session, and it does not impersonate the operator who enqueued the
job.

The migration and grant review for Ticket 13 must create a dedicated database
role with only the privileges needed to claim jobs, refresh heartbeats, update
progress, finalize jobs, write safe diagnostics and audit records, and upsert
the song catalog. The role must not receive general owner privileges, DDL,
`DELETE` or `TRUNCATE`. Worker credentials never enter client code, logs, audit
records or diagnostics.

### Audit

Required audit records are fail-closed and transactionally coupled to the state
change they describe:

- `import.start` is written atomically with enqueue;
- `import.cancel` is written atomically with queued cancellation or a running
  cancellation request;
- `import.complete` is written atomically with `succeeded`;
- `import.fail` is written atomically with `failed`.

Audit must distinguish a system actor from both a human operator and an operator
whose account was later removed. The durable audit model requires an explicit
`actor_kind` that distinguishes `operator` from `system`. A system actor uses
`actor_kind = system` and a NULL `operator_id`; it must never be represented by
a service account pretending to be a human operator. Migration `0019` review
must define the backfill for existing audit records and decide whether a
separate `legacy` value is required.

Audit and durable diagnostics never contain raw errors, stack traces, tokens,
cookies, credentials, complete Auth payloads, source API responses, CSV bodies,
signed URLs or private storage paths. They use stable safe codes and bounded,
sanitized summaries.

## Ticket 13 Data Direction

Ticket 13 requires a reviewed Drizzle migration `0019`. This ADR approves the
direction, not final SQL or column names:

- attempt count;
- UUID claim token;
- lease expiry timestamp;
- heartbeat timestamp;
- explicit audit actor kind distinguishing operator and system actors;
- a claim and stale-recovery index matching the final claim query;
- consistency checks for active claims, leases and terminal state;
- database-enforced terminal-state immutability.

The migration review must finalize names, defaults, nullable expansion,
backfill, indexes, constraints, runtime writer ordering, rollback and
forward-fix strategy. No worker code may depend on these fields before the
migration is applied and verified in its target environment.

## Importer Delivery Order

Ticket 13 starts with iSing as the first vertical slice. The current iSing
import logic is extracted into a worker adapter that accepts job context,
bounded batch persistence, heartbeat and cancellation callbacks. The existing
CLI may remain as a thin wrapper over the same adapter so operational use and
tests do not maintain a second importer implementation.

The worker checks cancellation and refreshes its heartbeat between batches.
Song writes retain the current `(source, source_song_id)` upsert identity and
never delete songs missing from a source response.

KaraFun is outside the first vertical slice. Its upload and execution remain a
separate later scope after private Supabase Storage, artifact authorization,
upload handoff and deletion evidence are implemented and reviewed. The future
worker adapter must stream the private file without putting file contents,
paths or signed URLs in `import_jobs`.

## Alternatives Considered

### Full Import In A Vercel Function

Rejected. Function execution is bounded and request-oriented. Extending a
request or starting unawaited work does not provide durable claiming, crash
recovery or cooperative cancellation for a full catalog import.

### Vercel Cron As The Worker

Rejected. Cron can trigger bounded work but is not a long-running supervised
worker. Delivery can overlap or repeat, and it does not replace database claim,
lease and idempotency rules.

### Supabase Edge Function As A Long-Running Worker

Rejected for import execution. Edge Functions have bounded runtime and resource
limits, while the existing Node importers and KaraFun streaming flow would need
runtime-specific adaptation. Supabase Cron remains eligible only for the short
cleanup trigger evaluated in Ticket 14.

### External Queue Or Workflow Service

Deferred. A managed queue could provide delivery, retries and observability,
but introduces another provider, cost, secret boundary and synchronization
model. The PostgreSQL queue already satisfies the current stage when paired
with a supervised worker and reviewed lease protocol.

### Service Account Pretending To Be An Operator

Rejected. It creates false audit attribution and couples background execution
to a human authorization model. System work has an explicit system actor.

### Retry By Creating A New Job

Rejected. It loses lifecycle continuity, complicates audit and counters, and
conflicts with one-active-per-source protection. Retry and crash recovery keep
the same job ID.

## Consequences And Risks

Positive consequences:

- durable state remains portable and queryable in PostgreSQL;
- the worker reuses the repository's Node, Drizzle and importer code;
- claim tokens prevent stale workers from finalizing reclaimed jobs;
- source-level uniqueness and same-job retry preserve a coherent history;
- provider-neutral hosting avoids coupling domain state to one queue vendor.

Operational costs and residual risks:

- the platform gains a separately deployed and monitored process;
- database polling adds bounded load and requires jitter and an indexed claim
  query;
- lease and heartbeat values require observation and may need later tuning;
- import adapters must remain idempotent because a batch can be retried;
- committed batch upserts can outlive a crashed or cancelled attempt;
- stale jobs, lease age, attempt count and terminal failures require alerts;
- provider selection must ensure secret isolation, health checks, restart
  policy and graceful shutdown.

On graceful shutdown, a worker stops claiming new jobs, finishes or safely
abandons the current bounded batch, and stops heartbeats. If it cannot complete
the job, another worker may reclaim it after lease expiry.

## Acceptance Checklist For Ticket 13

- [ ] Reviewed and verified migration `0019`.
- [ ] Complete iSing vertical slice with a worker adapter shared with a thin
      CLI wrapper.
- [ ] `worker --once` mode for controlled execution.
- [ ] Supervised polling mode with graceful shutdown.
- [ ] Atomic claim using `FOR UPDATE SKIP LOCKED` and conditional update.
- [ ] Deterministic claim/claim, claim/cancel and complete/cancel tests.
- [ ] Lease expiry and crash recovery on the same job ID.
- [ ] Cooperative cancellation between bounded batches.
- [ ] Explicit system audit actor and atomic success/failure audit.
- [ ] PostgreSQL 15 and PostgreSQL 17 integration coverage.
- [ ] No raw errors, credentials, Auth data or private artifact locations in
      durable records or logs.
- [ ] One-active-per-source protection test.
- [ ] Concurrent claims for two sources using synthetic iSing and KaraFun jobs,
      without requiring a KaraFun importer adapter.
- [ ] Full `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` and
      `git diff --check` gates.

## Verification Of This ADR

Ticket 12 is complete when architecture, database, security and operations
reviews accept this decision and Ticket 13 can proceed without selecting a
worker, storage or scheduler architecture inside implementation code.
