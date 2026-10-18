# Production P0 performance incident — 18 October 2026

## Decision and scope

**NO-GO for declaring the production incident resolved.** The local candidate removes redundant queue round trips, preserves transaction/security semantics and improves diagnosis. It does not yet demonstrate the required end-to-end 5-second budget with production-like database latency. The production search timeout is confirmed, but its exact query and failing plan cannot be reconstructed from the retained telemetry. No speculative ranking change or higher SQL timeout is included.

Worktree: `fair-queue-v2/pozanuta-stage-1`; parent `6c6d3f884a1e26919d98db75b816bb19f3c58344`; local branch `michal-szwindowski/kunestu-p0-performance`. The local checkpoint containing this report is a candidate for review, not permission to deploy it.

Production was inspected through read-only Vercel tools and an explicitly read-only PostgreSQL transaction. Deployment `dpl_4YxXwaAFhks3tDs1HLEQ5KKwJzCH` remains READY, SHA `6c6d3f8`, project `pozanuta`, function region `iad1`. The existing public URL remains `https://pozanuta.vercel.app`. Supabase target validation checks the designated project ref `qwmimnhdnzqfckswxjww`, the connection username/host, public project URL and verified TLS. PostgreSQL reports 170006. No production writes, migrations, deployment, region change, suspend/resume, rollback, push or domain operation were performed.

## Confirmed queue mechanism

The original placement traverses 49 application SQL statements on the four-request synthetic fixture. It authorizes/locks twice, loads several full presentations containing song/identity/history data, queries snapshot metadata separately and sends one update for each changed position. Ordinary fast SQL still pays the database wire cost. Production semantic reads/guards were approximately 185–191 ms each. This is strong evidence for the round-trip mechanism; it is not a pure network RTT measurement or proof that locks/pool/cold starts never contribute.

The controlled local proxy reproduces this scale: 90 ms independently delayed server-to-client packets produce a measured **185.9–188.3 ms** parameterized-query calibration and an original placement of **9,450 ms**. This closely matches the earlier production HTTP responses of 9,448/9,467 ms. The proxy does not introduce SQL sleeps, lock holders or a serial artificial reply queue. PostgreSQL extended-protocol describe/bind exchanges explain why a logical query costs more than one packet delay. `prepare:false` is preserved. The initial Promise.all-only experiment did not remove those exchanges and was discarded as an optimization strategy.

The first proxy implementation incorrectly waited for ReadyForQuery and deadlocked the protocol. Its run was terminated and rejected. Its log is retained; none of its timings are used. SQL counts exclude driver BEGIN/COMMIT and must not be confused with TCP packet counts. Baseline timing is a single observation per action, not a p95 or production SLO estimate.

### Candidate changes

- Reuse an authorization proof only in the exact transaction and auth/organization/event scope that created it. Keep the initial RBAC check, lifecycle lock, session mutex and post-mutex RBAC recheck. Forged/copied/cross-scope/cross-transaction proofs fail before mutation. Ordinary legacy routes still authorize normally.
- Validate semantic intent against a compact request/version/status/position projection, not a full identity/song/history presentation. Fair Sort revision and anchor/version checks remain enforced under the mutex.
- Combine stream/sort/ack metadata into one parameterized SQL statement. Acknowledgements still bind event, actor, device and operation IDs.
- Reuse the domain mutation's canonical presentation after receipt/audit writes. Those extra audit actions are excluded from presentation inputs; final stream metadata is read afterwards. Integration tests compare the returned items with a subsequent canonical snapshot.
- Batch Fair Queue position updates in one parameterized UPDATE with a materialized ID-ordered FOR UPDATE CTE. Preserve event/status predicates, per-row version semantics, timestamps and row triggers. No Fair Queue mathematics changes.
- Perform snapshot authorization and lifecycle reads in the same repeatable-read transaction with all active workspace/profile/membership predicates. Viewers remain read-only.
- Correlate HTTP/auth/transaction/phase telemetry under one internal request ID. Add queue phase and search admission/statement timing, without SQL text, parameters, tokens or participant data.

Receipt, provenance and domain mutation remain in one transaction. HTTP retry retains the same operation ID and cannot execute twice. No browser collaboration/reconciliation algorithm, API shape, RBAC policy, schema, outbox storage or Realtime payload was redesigned.

### Before/after: controlled wire experiment

Windows 11, Node 24.19.0, Docker PostgreSQL 17, pool max 2, prepare false; four synthetic requests, one event, same actions and schema through 0036. Full raw local evidence is retained in `.artifacts/p0-queue-*.json`; sanitized aggregates are committed in `docs/verification/p0-performance-local-2026-10-18.json`.

| Service operation | Baseline ms / SQL | Candidate ms / SQL |
|---|---:|---:|
| Placement | 9,450 / 49 | 5,336 / 27 |
| Approve | 7,857 / 41 | 4,667 / 24 |
| Start | 7,500 / 39 | 4,323 / 22 |
| Done | 7,105 / 37 | 3,962 / 20 |
| Receipt replay | 2,803 / 14 | 2,436 / 12 |
| Snapshot | 2,352 / 12 | 1,603 / 8 |

Placement reduction is approximately 44%. **The candidate placement alone exceeds 5 seconds in this delayed-wire scenario.** Adding a peer snapshot does not satisfy the requested end-to-end budget. No production improvement is claimed.

The zero-delay proxy run measured placement 868 ms, approve 769 ms, start 716 ms, done 638 ms, replay 385 ms and snapshot 262 ms. Its parameterized calibration is still about 30 ms because of the Windows/JS proxy path. These are not native direct-database localhost timings.

### Time attribution and limits

| Stage | Evidence / interpretation |
|---|---|
| Local UI | Earlier production DnD assertion 25 ms; fresh browser distributions recorded separately below. |
| HTTP preparation/transit | Not separately measured in production; HTTP response and click-to-peer measurements include client/browser scheduling. |
| Auth | A correlated production sample: claims 3 ms, linked-operator lookup 190 ms, session total 195 ms. Not all requests have this profile. |
| Pool checkout and BEGIN | Candidate transaction attempt to callback about 107 ms; includes BEGIN/protocol and checkout. Pure pool wait is not isolated. |
| Authorization/lifecycle/mutex | Candidate delayed placement 943 ms total; lifecycle read 188 ms. Mutex timing includes the SQL exchange, not pure lock wait. Sampled production snapshots showed no blocked/long transactions; transient waits are not ruled out. |
| Receipt lookup | Separate SQL between the guard and initial state; not silently attributed to mutation. |
| Initial intent state | Candidate 190 ms. Original production full snapshot duration not available. |
| Mutation | Candidate 3,055 ms including domain checks, Fair Queue reads, updates, audit and canonical presentation. |
| Receipt and provenance | Candidate 385 ms. |
| Final metadata | Candidate 185 ms; canonical items already obtained by domain mutation. |
| Commit | Final-read-to-commit tail 94.6 ms, including commit wire/driver scheduling. Included in 5,229 ms callback-to-commit. No separate production commit measurement. |
| API response | Earlier production POST 9,448/9,467 ms; fresh browser HTTP acknowledgment includes serialization/transit/client observation. |
| Realtime publish/delivery | No isolated production publisher/delivery clock. Triggered invalidation/refetch remains unchanged. Do not label residual click-to-peer time as pure WebSocket latency. |
| Peer reconciliation | Earlier production 11,902–13,166 ms from gesture; fresh local browser measurements include invalidation, snapshot and render. |

The original `/queue/sync` handler lacked an outer telemetry context, so nested operations minted different application request IDs. Vercel invocation metadata allows grouping some records, but a complete historical phase waterfall is unavailable. The candidate supplies that context. Trace timestamps and durations distinguish nested operations; nested durations must not be summed twice.

## Search 57014

Fresh read-only log inspection identifies one correlated failure: session lookup **189.6 ms**, then `song_search.unicode_v2` **2,572.6 ms**, classified **DB_STATEMENT_TIMEOUT**. The detailed failure log is at **12:17:37.287 UTC**; the earlier error-group summary labels the incident at 12:17:34 UTC, when that request/search phase started. Adjacent successful Unicode service calls took 704/1,416 ms. Sanitized retained evidence is `docs/verification/p0-production-search-telemetry-2026-10-18.json`.

This confirms cancellation by statement timeout in the search phase after session authorization. It does not identify a fuzzy/literal branch or isolate execution from describe/bind protocol time. Admission exhaustion is a separate bounded 6-second path returning 503; connection failures have different classifications. No evidence shows admission exhaustion caused this 57014. The current trace lacks admission/statement subspans, which the candidate adds.

The production catalog contains about 92,014 documents. All five inspected search indexes, including 0034's expression GiST index, are valid and ready. Documents were autoanalyzed on October 16; missing/invalid indexes are not demonstrated. Historical pg_stat_statements aggregates include successful maximum execution times near 1.8–1.9 seconds, but they mix query shapes and time periods and do not retain the failed query's bound values. They cannot prove the failing plan.

PostgreSQL's [statement_timeout documentation](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-STATEMENT-TIMEOUT) states that extended-protocol timing begins on a query-related message, including Parse/Describe. The installed unprepared driver describes parameterized statements before binding. Thus two seconds is not necessarily two seconds of CPU execution; the production contribution is unmeasured. The SQL timeout remains **2,000 ms**, with no ranking, fuzzy, cursor or index change.

### Isolated catalog experiment

An existing verified PG17 restore is networkless with no published ports. Only public catalog fields were copied through an in-memory binary pipe to an owned, disposable PG17 database. No Auth rows, participant records, sessions, secrets or private backup contents entered the test application. The source restore and encrypted backup were not changed.

The destination regenerates projections through current triggers and runs ANALYZE. Consequently its cache, statistics, hardware and resource isolation differ from Supabase Free; this limitation prevents claiming a production reproduction. Alias input is empty in this snapshot. Existing multilingual/alias/fuzzy quality fixtures provide the complementary regression coverage.

The frozen SHA-6c6d3f8 search SQL and candidate return identical full first pages/cursors and second pages where present. Sixteen selected queries include accented Latin, PL/UK/CJK, misspellings, short and broad phrases and no-result phrases. **64 timed first-page calls: no timeout; maximum about 142 ms.** Twenty concurrent requests with pool/admission 2 returned matching pages in **87–415 ms**, without timeout or capacity error. EXPLAIN ANALYZE/BUFFERS plans are retained locally and index-name/execution summaries committed. The diagnostic EXPLAIN transaction uses a 15-second inspection ceiling; application executions still use 2 seconds.

An intermediate harness run failed because a local editing script changed query-literal encoding and the cursor assertion used the unnormalized query. UTF-8 handling and normalized cursor validation were corrected; unexpected errors are rethrown, not recorded as passing samples. That run is retained as failed evidence and is not included in final metrics.

**Search incident status: PARTIAL.** No catalog-specific optimization is justified by the reproduced plans. Deployment of diagnostic spans would require separate approval, followed by a controlled, narrowly scoped production observation. The exact failed production phrase/plan and competition for shared CPU/I/O remain unresolved.

## Verification and browser results

Functional browser verification is complete; a performance gate remains red. The failure is preserved and makes the overall result NO-GO.

- Node: 430/430; Vitest: 750/750 on candidate application code.
- PG17 collaboration/current-event default/presentation: 26/26, including new authorization-proof and snapshot access negative paths.
- PG17 contention: 4/4 after fixing an obsolete migration fixture.
- PG17 participant identity/Fair Queue/DnD/Presence/linking/merge: 28/28 after fixture correction; complementary identity/discovery/catalog/driver files 26/26 in the earlier combined run.
- PG17 search quality: 3/3; admission/security: 2/2; Realtime scope: 1/1; database timeout paths: 3/3.
- Catalog comparison: 1/1 final expanded experiment; delayed-wire and zero-delay experiments 1/1 each for integrity/replay/canonical state, **not** a passing 5-second latency gate.
- Final repeated gates: `pnpm test` 430 Node + 750 Vitest PASS; typecheck PASS; lint exit 0 with 10 pre-existing warnings confined to unrelated ignored release helpers; clean optimized build PASS through the guarded build-only runner; diff check PASS. Both normal and fault-injected builds compiled, and the final build contains no injection routes/hooks.

Old contention and participant fixtures applied selected migrations only through 0033. Current application code reads the 0036 engine column, and two seed paths still produced eight-digit codes despite the current six-digit constraint. Fixtures now use the complete schema through 0036 and valid six-digit codes. Historical Slice 5 cases explicitly pin their event to legacy so their existing mathematical/audit assertions remain meaningful; separate current-schema tests verify the v2 default and emergency legacy fallback. Assertions and production constraints were not relaxed.

The first broad browser run incorrectly enabled recovery-fixture tests without their source-restoring wrapper. Four forced-error cases therefore reached 404 instead of injected faults. That is a test invocation error, not proof of a product error. Its 100-row UI measurement also exceeded the 100-ms local p95 budget (116.2 ms) while other local database suites were running. Both failures remain recorded: **36 passed, 5 failed** in 17 minutes. Other covered cases include real two-account/device collaboration, independent/conflicting/rapid movements, start/done, lost-response receipts, offline/reconnect/token renewal, Realtime organization isolation, linking/identity, PL/EN/UK search, mobile/touch emulation and pointer/keyboard DnD.

The correct source-restoring wrapper was then run with `--collaboration`, with no parallel database/CPU test workload: **18 passed, 1 failed**, in 2 minutes. All six recovery/product cases and functional collaboration cases pass. Temporary fault routes/layout hooks were restored byte-for-byte (layout SHA `8246a883…80a1`); no hooks ship in the checkpoint. The 100-row performance failure reproduced, so it cannot be dismissed as background workload noise. No limit was increased and no assertion skipped to obtain a pass.

Fresh browser measurements use optimized Next 16.3, real local Supabase Auth/Realtime/PG17 and two headless Chromium contexts on Windows 11, Ryzen 7 5700X3D, 16 logical CPUs, 32 GiB RAM. Ten alternating moves per size; with n=10, the reported p95 equals the largest sample. These measure native application updates, not the wire-delay proxy.

| Rows | First run UI / HTTP / peer p95 ms | Quiet repeat UI / HTTP / peer p95 ms |
|---|---:|---:|
| 20 | 35.9 / 289.7 / 436.9 | 36.9 / 294.2 / 389.5 |
| 50 | 83.2 / 410.6 / 644.8 | 50.3 / 363.1 / 555.8 |
| 100 | **116.2** / 511.5 / 833.7 | **126.9** / 573.2 / 915.4 |

Peer p95/max passes the local 2-second/5-second gates; 100-row local UI p95 fails the 100-ms gate in both runs. No frontend optimization is bundled without profiling evidence. This is an additional confirmed limitation of the candidate, not evidence that the SQL change caused a rendering regression; the same-machine pre-hotfix 100-row rendering baseline was not measured in this incident.

Commands/evidence:

```text
pnpm test
pnpm typecheck
pnpm lint
pnpm build (guarded isolated runner, LOCAL_E2E_BUILD_ONLY=1)
git diff --check
pnpm exec vitest run --config vitest.p0-performance.config.ts
pnpm exec vitest run --config vitest.p0-search.config.ts
pnpm exec vitest run --config vitest.queue-collaboration-postgres.config.ts
pnpm exec vitest run --config vitest.db-contention.config.ts
pnpm exec vitest run --config vitest.public-session-postgres.config.ts
pnpm exec vitest run --config vitest.song-search-unicode-quality.config.ts
pnpm exec vitest run --config vitest.db-timeouts.config.ts
pnpm exec vitest run --config vitest.release-gate.config.ts tests/postgres/realtimeQueueScope.integration.test.ts
pnpm exec vitest run --config vitest.search-reliability.config.ts tests/postgres/searchAdmission.integration.test.ts tests/postgres/searchSecurity.integration.test.ts
node --experimental-strip-types tests/e2e/with-product-completion-fixtures.ts --collaboration
```

The catalog experiment requires `LOCAL_P0_CATALOG_CLONE` naming a verified networkless local restore. The wire benchmark uses `LOCAL_QUEUE_WIRE_DELAY_MS=90` (or 0) and `LOCAL_QUEUE_LABEL`. All database runners fail closed on cloud environment files and create owned test targets. Local `.artifacts/p0-*` logs, plans and failure traces remain available; sanitized numerical/semantic summaries are committed. Failed harness and obsolete-fixture runs are retained, not reclassified as successful.

Physical tablet/touch performance, real mobile network behavior, production post-hotfix latency and production timeout elimination are not verified. Emulated touch is not a physical-device PASS.

## Region option — separate authorization

Current deployment metadata and the function's VERCEL_REGION identify iad1; some log transport/edge-region fields show fra1/arn1. Those fields do not prove the function executed next to Supabase. The deployed configuration has no repository vercel.json region override.

Vercel documents [function-region configuration](https://vercel.com/docs/functions/configuring-functions/region), including a single region on Hobby and a region override through configuration/deployment. Choosing fra1 nearer eu-central-1 is a plausible way to reduce each database exchange, **not a measured improvement for this application**. No region configuration was changed.

A separately authorized experiment should keep the same code/schema/catalog and domain, verify the emitted runtime region, compare cold/warm API, database phase and peer visibility distributions, and monitor Auth, Realtime and connection counts. Proxy/CDN placement differs from function placement. Snapshot the old deployment and region first. Standard Vercel rollback can return the application version/region to the previous deployment while preserving the existing domain; it does not undo database migrations. No global setting or alias operation is needed in this task.

## Release/STOP plan

1. Review the focused local checkpoint and the unresolved latency/search findings. **STOP** if approval expects the incident already to be solved: the 5-second delayed-wire gate is still red.
2. Obtain separate authorization for any production push/deployment or regional experiment. None is covered by this local hotfix task.
3. Preserve READY deployment `dpl_4YxXwaAFhks3tDs1HLEQ5KKwJzCH` as rollback target. Preserve the existing domain assignments and current feature flags. This candidate requires no migration or backfill.
4. After authorization, release only this candidate to the existing project. Do not repeat 0032–0036, suspend/resume or change real participant queues. Use a separately approved isolated test event; ensure it cannot become the public active event or alter another event's history.
5. Observe safe correlated phase metrics, actual region, 409/401/503/57014 rates, lock/connection pressure, receipts and peer convergence. **STOP** on data loss, double application, RBAC leakage, unexpected mutations, unresolved timeout, or representative peer visibility over 5 seconds. Do not raise SQL timeout to bypass a failed gate.
6. Rollback only after the owner authorizes that action: use the previous Vercel deployment through the standard existing-domain mechanism. Schema and receipts remain compatible. Search legacy fallback is an optional separately authorized setting change; no destructive database rollback.

## Preservation, files and tools

Unrelated untracked `enterprise-production-release-execution.md` and `final-production-release-execution.md` remain excluded. Protected root config hash remains `b3129521…291b`; protected root readiness report `49e74b1e…8b62`. Worktree copies have distinct pre-existing hashes/October 17 timestamps and were also not edited. Backups, existing restore containers, migrations, prior checkpoints and unrelated local Supabase projects remain intact.

Only owned disposable test containers are cleaned by their harnesses. The first production-inspection connection's startup read-only option was not effective: the guard observed `off` and stopped after the identity SELECT. The successful metadata inspection used explicit BEGIN READ ONLY and verified transaction_read_only=on before reading catalog metadata. No production mutation was issued.

One raw MCP log presentation included a controlled-session token in its path. Later reads were filtered before display, and committed evidence excludes paths/tokens. No credentials or token values are included in this report, the checkpoint or benchmark summaries.

External tools: read-only Vercel deployment/runtime-log MCP, PostgreSQL driver for bounded metadata reads, Docker PostgreSQL 17, isolated Supabase CLI 2.109.1, Chromium/Playwright, Context7 for Postgres.js pipelining semantics, official PostgreSQL/Vercel web documentation. No generic Supabase MCP or GitHub mutation was used. The Supabase changelog markdown endpoint returned an error; no Supabase service behavior or SDK API was changed based on an unverified claim.

Checkpoint files (17, excluding temporary fault-injection sources):

1. `src/app/api/dashboard/organizations/[organizationId]/events/[eventId]/queue/sync/route.ts`
2. `src/server/operator-api/event-queue.ts`
3. `src/server/operator-api/fair-queue-store.ts`
4. `src/server/operator-api/queue-sync.ts`
5. `src/server/song-search-admission.ts`
6. `src/server/song-search-unicode.ts`
7. `tests/postgres/dbContention.integration.test.ts`
8. `tests/postgres/participantIdentity.integration.test.ts`
9. `tests/postgres/queueCollaboration.integration.test.ts`
10. `tests/postgres/queueSyncLatency.integration.test.ts`
11. `tests/postgres/searchP0Catalog.integration.test.ts`
12. `tests/fixtures/song-search-unicode-p0-baseline.ts`
13. `vitest.p0-performance.config.ts`
14. `vitest.p0-search.config.ts`
15. `docs/features/production-p0-performance-incident.md`
16. `docs/verification/p0-performance-local-2026-10-18.json`
17. `docs/verification/p0-production-search-telemetry-2026-10-18.json`

Final verification: functional candidate verified locally; overall **NO-GO**. Three remaining blockers/limitations are explicit: the calibrated delayed-wire path does not satisfy 5-second peer visibility, the 100-row UI p95 budget fails twice, and the exact production Search timeout plan is not reproduced. None is waived by passing unit/integrity checks. Review this local checkpoint before authorizing any narrowly scoped production diagnostic release or regional experiment.
