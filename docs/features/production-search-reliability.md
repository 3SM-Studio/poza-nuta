# Production search reliability, database performance and security hardening

Local work on branch `michal-szwindowski/kunestu-search-reliability`, based on
`73bf9d0dee8d62493a37ac91706c3f367f9de55f`. No push, deployment, remote migration,
backfill, Auth/WAF change or production data write. Final checkpoint SHA is supplied
in the closing handoff and the ignored `.artifacts/search-checkpoint-receipt.json`.
The exact file set and hashes are in `production-search-reliability-files.json`.

Final verification (2026-10-17): local implementation and regression gates PASS.
Hosted security verification PARTIAL; production rollout remains NO-GO until the
separate preflight and owner approval below. This task ends at a local checkpoint.

## Confirmed causes and boundaries

The active Vercel alias was freshly read through the Vercel connector: existing
project `pozanuta`, deployment `dpl_2HM5HjWHffVM7zH76BUMngXbx85V`, Production READY,
SHA `703c145dc21a2b1eb58370a93058402ffbb4f48b`, region `iad1`. Its locally available
Unicode search source is byte-identical to checkpoint 73bf9d0's frozen baseline.
A CLI/API credential attempt returned 403; the subsequently available connector
provided the successful metadata read. No domain/alias was modified.

The task's supplied production evidence contains 38 infrastructure failures with
57014, across public and token-session search, and PostgreSQL statement-timeout
messages. Local reproduction proves the baseline's expensive path: when fewer
than 100 strong candidates exist, broad fuzzy predicates score a large fraction
of the catalog and sort before limiting to 200 candidates. The measured plan for
`artist 30000` scans about 92k documents (30,671 rows per parallel worker, three
loops). Final CASE ranking is applied to bounded candidates; it is not the main
full-catalog cost. Existing B-tree, GIN grams and trigram indexes were present.

The 2s Unicode statement timeout is real and unchanged. The owned 2-CPU probe
reproduces cancellations: baseline 20 different searches with 20 connections
cancelled 20/20. This establishes a causal execution/resource mechanism, not a
request-by-request attribution for every historical production error. The token
route also performs session/lifecycle access reads before search; those must be
correlated separately. New semantic route/engine execution telemetry distinguishes
statement timeout from lock timeout without logging queries, tokens or personal data.

The supplied category statistics are cumulative since 2026-08-05, not 24 hours:
2328 genre aggregations / 957.6s; 2309 language aggregations / 429.0s; 2458 ranking
calls / 722.1s. Code confirmed three uncached discovery queries per visit/load.
The public `/api/public/songs/search` route additionally lacked the session route's
application rate limiter. A browser-side failure also prevented retrying an unchanged
query via Enter, and could display the preceding query's rows under the failed query.

The safe live Vercel log aggregation returned no 57014/55P03 groups in the available
30-minute window. A 24-hour read was rejected by Hobby retention. This does not prove
historical failures are gone. Older 55P03 cases are not search-timeout fixes: queue
and driver regressions are tested separately. No current production SQL inspection
was made: configured local environment targets are loopback, and the required
project-scoped `supabase-dev` connector is unavailable. Owner-designated production
ref remains `qwmimnhdnzqfckswxjww`; no unverified database connection was opened.

## Final application changes

- Migration 0034 adds only an expression GiST index on `(search_text || '')` with
  a 256-byte signature. Multi-token fuzzy uses KNN distance, exact similarity DESC
  and original ID; the latter preserves order at rounded float4 distance ties.
  The same predicate, 0.5 threshold, candidate set/caps, ranking, aliases and cursor
  version/page size remain. Single-token fuzzy and literal/short-query paths retain
  their original plans. The expression prevents diverting plain-column GIN plans.
- Identical in-flight database/engine/query/cursor reads share one execution.
  Completed results are not cached. Distinct pending keys are capped at 128 per
  process; duplicates may join at capacity. Errors propagate and capacity recovers.
- Two transaction-level advisory slots limit searches across application instances
  in the same database. Failed nonblocking attempts commit before application-side
  backoff; no connection is held intentionally while sleeping. The 6s admission
  budget and explicit 503 are separate from the unchanged 2s Unicode SQL timeout.
  Old code, imports, browsing and unrelated SQL are not globally capped by this.
  See `../architecture/adr-song-search-capacity.md` for keyspace, pooling and limits.
- Category discovery has a 60s lazy cache per database/process. Concurrent loads
  share one promise, failures are not retained, and an old failure cannot evict a
  newer entry. External imports converge through TTL on the next read; there is
  no claim of global immediate invalidation. Session access is checked on every
  request, even with a warm cache. No participant/event/Auth data is cached.
- Search budgets are separate from mutation/presence budgets: 120/minute per
  participant credential hash, 120/minute per network without a valid cookie shape,
  plus 2400/minute/network against cookie rotation. These are process-local defense
  in depth, not distributed WAF protection. Search counters cannot fill the mutation
  bucket map. Cookie hints confer no authorization. No new client identity storage.
- Errors stay errors: existing safe 503 contracts are retained; no global console
  suppression or fallback-to-empty/legacy. The UI permits retrying the same query
  and removes stale previous rows on failure. PL/EN/UK messages already exist.

No Fair Queue mathematics, 2/2 rules, DnD/outbox/idempotency, participant identity,
permissions, session routes/tokens, song names or Realtime transport were changed.
Dashboard remains Polish. Unicode normalization and legacy projections are unchanged.
The shared Drizzle schema snapshot differs only in the added index and snapshot IDs.

## Before/after on owned PostgreSQL 17

Primary immutable evidence: `search-reliability-results.json` and ignored
`.artifacts/search-reliability-admission-two-cpu-verified.json` (raw plans, hashes).
Capture UTC: 2026-10-17T21:25:34.009Z / 2026-10-17T21:29:47.881Z. PostgreSQL 17.10 Alpine, Node 24.19.0, pnpm 11.7.0;
Windows 11 Pro 10.0.26300, Ryzen 7 5700X3D / 16 logical CPUs, 31.93 GiB host RAM,
15.58 GiB Docker memory limit, **benchmark container limited to 2 CPUs**. Other local
services coexist; this is not dedicated hardware or a measurement of Supabase's plan.

92,014 synthetic scale songs plus multilingual fixtures, generated through the real
projection trigger, ANALYZE before reads. Ten repeated title families, 2500 artist
keys, numeric suffixes and metadata intentionally expose broad fuzzy matches. No
provider catalog or production participant data was copied. Baseline is frozen
73bf9d0 SQL; current service combines the index, admission and single-flight.

Four heavy query templates are rotated through four sequential searches per client;
1/5/20 clients run concurrently. Times are catalog-service wall time, including local
pool/admission waiting, excluding HTTP/access/DOM/network. Quantiles use nearest rank;
n=4 p95/p99 are the maximum, not statistically robust tail estimates. SQL counters
include Drizzle execute calls (permit/config/ranking), excluding BEGIN/COMMIT/admin.

| Clients | Version | n | p50 ms | p95 ms | p99 ms | SQL cancellations | Capacity errors | SQL statements |
|---|---|---|---|---|---|---|---|---|
| 1 | baseline | 4 | 618 | 668 | 668 | 0 | 0 | 8 |
| 1 | final | 4 | 324 | 707 | 707 | 0 | 0 | 12 |
| 5 | baseline | 20 | 3173 | 3788 | 4586 | 0 | 0 | 40 |
| 5 | final | 20 | 344 | 1175 | 1325 | 0 | 0 | 21 |
| 20 | baseline | 80 | 13124 | 15600 | 15987 | 9 | 0 | 160 |
| 20 | final | 80 | 662 | 1337 | 1337 | 0 | 0 | 21 |

A separate 20-request burst uses **20 different** heavy queries; no deduplication
benefit is possible. Pool 20 emulates aggregate connection pressure, not a claim of
20 Vercel processes or distributed memory. Every final request completed:

| Pool max | Version | p50 ms | p95 ms | p99 ms | SQL cancellations | Capacity errors | SQL statements |
|---|---|---|---|---|---|---|---|
| 2 | baseline | 9569 | 18787 | 18916 | 3/20 | 0/20 | 40 |
| 2 | optimized-service | 1766 | 3516 | 3549 | 0/20 | 0/20 | 60 |
| 20 | baseline | 2180 | 2181 | 2273 | 20/20 | 0/20 | 40 |
| 20 | optimized-service | 2398 | 4387 | 4420 | 0/20 | 0/20 | 324 |

The baseline's short 20-connection latency is **cancellation latency**, not successful
search latency. The final limiter intentionally trades unconstrained parallelism
for bounded CPU and usable results. Cheap permit attempts can increase total SQL
counts under contention (324 versus 40 in that burst); lower expensive query work
must not be reported as a universal decrease in every SQL call or cloud bill.
The uncoalesced `optimized-sql` control includes new SQL/admission but omits
single-flight: it returned 8 capacity errors/80 and does not pass service acceptance.
The final `optimized-service` workload has zero of either error.

Local budgets: repeated workloads p95 <2s; distinct 20-query bursts p95 <5s with
both pool sizes; zero cancellations and capacity errors in final-service scenarios.
All pass in the recorded quota-limited run. These budgets are not an SLA for unknown
hosted resources, network latency, continuous overload or an adversarial catalog.

The index is 18.85 MiB and built in 2179 ms locally. This is not a hosted
lock-duration promise. It adds storage/write work to the existing derived projection.
Resource snapshots remain around the 2-CPU quota, with observed container memory
roughly 170–300 MiB; they are not peak or cumulative CPU accounting. An idle sample
and one snapshot per workload are preserved. Four database client backends were
observed before the 20-connection stress; configured pool size is recorded separately,
not misrepresented as a measured peak physical-connection count.

The 23-query sweep includes short terms, no hit, long no-hit, common/rare titles,
PL accents, Cyrillic/CJK, typos in both words and digit tokens. Complete first pages
and every available second page/cursor match the frozen baseline. Original-script
and alias quality are also verified in the separate full corpus suites. Not every
query gets faster: e.g. `love tonight 90000` trades higher single-query KNN cost for
lower aggregate contention. No global recall/transliteration improvement is claimed.

A simplified pair of genre/language aggregates on 20 concurrent callers changes
40 actual aggregate statements to 2. Production discovery also includes one feature
aggregate, which shares the cache. The pair benchmark excludes that feature query
and session access; it is not an exact HTTP discovery response measurement.
Rapid ten-character-prefix server bursts are measured separately without pretending
that HTTP abort cancels SQL; the actual UI's 250ms debounce is checked in a browser.

Rejected experiments remain preserved: plain-column GiST64 regressed a dense
single-word typo; materialized/lateral single-score variants were slower; an
index-only 1024-byte-signature/2-CPU probe still cancelled 20/20 distinct searches.
The selected expression index avoids the single-word regression, and admission is
required. Earlier workstation-only numbers without admission are historical controls,
not final hosted-readiness evidence.

## Security conclusions

See `../runbooks/search-security-hardening.md`. Local negative tests prove the
backend-only RLS/grant boundary and the event-trigger invocation/revoke behavior.
They do not substitute for freshly inspecting the hosted function body, grants,
extension placement, Auth configuration or plan. A SECURITY DEFINER event-trigger
with EXECUTE is not automatically an exploitable public RPC. Proposed ACL reduction
remains a separately approved action; no broad SELECT policy is added. pg_trgm is
not relocated. Leaked-password protection is documented as Pro-and-above; actual
Supabase availability/settings remain unverified. No Auth or plan setting changed.

The active custom Vercel firewall configuration read returned 404 (Seawall Config
not found). This is not proof that all platform DDoS controls are absent, but custom
search quota coverage is not verified. Edge/IP trust, distributed NAT-aware limits
and app/database region latency need preflight before a hosted protection claim.

## Verification and release boundary

Fresh functional checks: 430 Node, 721 Vitest, typecheck and lint passed after the
admission changes. Owned PG17 suites cover legacy/v2 ranking and SQL/API/component
integration; Unicode parity/backfill/import/aliases/pagination; cancellation and
pool recovery; migration upgrade/recovery; advisory-slot bounds/rollback/deadline;
public sessions, warm-cache authorization, 2/2, identity/linking/merge/Presence;
Postgres.js faults; collaboration/queue/Fair Queue; contention/timeouts/guest queue.
Fresh owned PG17 evidence (96 passed protocol/integration tests): legacy search 2,
Unicode quality/SQL-API-UI/adversarial 3, full Unicode/parity/cancellation 2,
migration/security/admission 3, final quota-limited benchmark 1; public/identity/driver
54, collaboration/presentation 22, contention 4, transaction timeouts 3, guest queue 2.
The benchmark separately records failing baseline/control performance; its runner
passing is not reported as the baseline meeting the final-service SLO.

Browser: fresh full optimized release-image run: **32/32 PASS**, 11.7 minutes,
including PL/EN/UK 503 -> identical-query retry, debounce, original Unicode titles
and equal result IDs across languages. Chromium 149.0.7827.55, Node 24.19.0,
unicode-v2 and rotation-v2, owned Supabase PostgreSQL 17.6/Auth/Realtime.
Capture UTC 2026-10-17T21:40:24.444Z: retry-to-visible PL 44.61ms, EN 39.25ms,
UK 39.02ms (one sample each, small synthetic browser fixture, loopback network;
not the 92k load benchmark). Each language generated two search requests: one
debounced injected 503 and one successful real-SQL retry. PL desktop 1440x900,
EN mobile viewport 390x900, UK mobile/touch emulation 390x900. These are not
physical-device or production-latency measurements.
Physical tablet/IME/Safari/WAN were not tested. No test ran against production.

After browser cleanup, fresh `pnpm test` (430 Node / 721 Vitest),
`pnpm typecheck`, `pnpm lint` and `git diff --check` passed. Required production
build is the actual `pnpm build` executed successfully by the owned optimized E2E
launcher on the same final runtime source, not an environment bypass. The owned
Supabase containers/data were removed by the launcher after exit 0; pre-existing
local services, backup containers and evidence files were preserved.

The first full browser run had 31 PASS and one test-handler failure (`unroute` during
fulfill). It was fixed using a one-shot route and the targeted PL/EN/UK scenario
passed. A later build caught implicit any[] benchmark arrays after partial-result
capture was added; explicit summary types fixed it, without weakening strict mode.
The first admission benchmark protocol recognized only SQL cancellations and failed
on a legitimate capacity rejection in the raw control. Capacity is now separately
counted and asserted absent from the actual final service. All failed logs/traces
remain; they are not counted as passing runs. No migration failed.

Production is **not modified and not yet approved to deploy**. Local integration
readiness passed the completed gates above; hosted release remains NO-GO pending
verified schema/history, storage/lock budget, builtin advisory-function permissions,
current backup/restore evidence, resource/region checks and owner approval for 0034
and any other pending integrated migrations. No fresh production backup claim is made.
Follow `../runbooks/song-search-fuzzy-distance-index.md`: schema/index first, verify,
then approved integrated application. A previous app may ignore/retain the index;
application rollback needs no destructive database rollback. Keep the same URL.
The existing separately controlled legacy fallback loses non-Latin coverage and
invalidates pending cursors; no remote flag was changed here.

Tools/services: local Git, pnpm/Node, Docker PG17 and local Supabase Auth/Realtime,
Playwright Chromium; Context7/official documentation and read-only Vercel connector.
No remote GitHub action, Supabase SQL/MCP mutation, production application operation,
commit/push/deployment outside the single authorized local checkpoint.

## Reproduction commands and evidence

All database commands below create guarded, owned PostgreSQL 17 fixtures; none
uses a hosted connection. Existing local environment guards remain enabled.

| Command / scope | Result | Ignored local evidence |
|---|---|---|
| `pnpm test` | 430 Node / 721 Vitest PASS | `search-checkpoint-test.log` |
| `pnpm typecheck`; `pnpm lint`; `git diff --check` | PASS | `search-checkpoint-typecheck.log`, `search-checkpoint-lint.log`, receipt |
| `pnpm test:postgres:song-search-quality` (legacy) | 2 PASS | `search-admission-quality-legacy.log` |
| `pnpm exec vitest run --config vitest.song-search-unicode-quality.config.ts` | 3 PASS | `search-admission-quality-v2.log` |
| `pnpm exec vitest run --config vitest.unicode-search-postgres.config.ts` | 2 PASS; 13,452 JS/SQL parity cases | `search-admission-unicode.log` |
| `pnpm exec vitest run --config vitest.search-reliability.config.ts` with the three admission/index/security files selected | 3 PASS | `search-final-index-security-admission.log` |
| `LOCAL_SEARCH_CPU_LIMIT=2 pnpm exec vitest run --config vitest.search-reliability.config.ts tests/postgres/searchReliability.integration.test.ts` | 1 protocol PASS, final-service budgets PASS | `search-reliability-admission-two-cpu-final.log` |
| `pnpm test:postgres:public-event-session-identity` | 54 PASS | `search-admission-public-regression.log` |
| `pnpm exec vitest run --config vitest.queue-collaboration-postgres.config.ts` | 22 PASS | `search-final-collaboration-regression.log` |
| `pnpm test:postgres:db-contention` | 4 PASS | `search-final-contention-regression.log` |
| `pnpm test:postgres:db-timeouts` | 3 PASS | `search-final-timeout-regression.log` |
| `pnpm test:postgres:guest-session-queue` | 2 PASS | `search-final-guest-regression.log` |
| `pnpm test:e2e:public-event-session-identity-local` with `LOCAL_E2E_OPTIMIZED=1`, `LOCAL_E2E_SEARCH_ENGINE=unicode-v2`, `LOCAL_E2E_FAIR_ENGINE=rotation-v2`, `LOCAL_E2E_SHORT_JWT=0` and no grep | actual build PASS; 32 E2E PASS | `search-browser-release-image-final.log` |

Environment assignments above use shell-neutral notation; in PowerShell set the
named `$env:` values before the command. Evidence filenames are relative to
`.artifacts/`. Artifacts are ignored and excluded from the commit. Compact sanitized
benchmark data and their raw SHA256 are committed separately; no tokens or user rows
are included. The exact manifest hashes source, tests, migration and documentation;
it excludes its own digest to avoid a recursive hash.

## Residual risks and verdict

| Area | Verdict / severity | Remaining verification |
|---|---|---|
| Local search correctness, performance budget and prior-module regressions | PASS | Synthetic corpus only; no real KaraFun recall claim |
| Local RLS / negative-path / admission safety tests | PASS | Synthetic function analogue is not a hosted definition |
| Hosted SECURITY DEFINER, RLS, Auth and pg_trgm inspection | PARTIAL; release preflight blocker | Project-scoped connector/access unavailable; verify actual definitions/ACL/settings without changing them |
| Migration and hosted recovery readiness | NO-GO for rollout | Verify history, restored backup, storage, lock window and runtime advisory-function permission before approval |
| Distributed HTTP abuse protection | Medium residual risk | Per-process quotas are not a distributed limiter; trusted ingress/WAF coverage and venue NAT behavior need hosted preflight |
| Admission under continuous overload | Medium residual risk | Bounded rejection, not FIFO/fairness; imports and categories also consume resources |
| Physical devices / real WAN / IME / Safari | Not executed | Manual smoke after separately approved release; no PASS claimed |

No confirmed new local authorization bypass, secret disclosure or data-loss defect
was found in the reviewed task diff. Hosted unknowns are not classified as fixed.
Accepted local tradeoffs: discovery TTL staleness; advisory attempts increasing cheap
SQL calls under contention; extra derived-index storage/write cost. None changes
participant fairness or write-side queue semantics.

The staged checkpoint must contain exactly the manifest file set, with no `.env`,
`.codex`, `.artifacts`, backup, log, `data`, trace or generated build file. Original
checkout private config and production-readiness document hashes were preserved;
73bf9d0 and the earlier foundation/integration checkpoints remain ancestors. The
local checkpoint does not modify any remote branch or deployment.
Final artifact/secret review: 43 allowlisted files; no new high-confidence secret
findings. Six credentialed-DSN pattern matches are unchanged parent test-harness
templates interpolating the owned container password/host/port, not real hosted
credentials. This is a task-diff review, not an audit of all repository history.

## Exact changed files

- `docs/architecture/adr-song-search-capacity.md`
- `docs/features/production-search-reliability-files.json`
- `docs/features/production-search-reliability.md`
- `docs/features/search-reliability-results.json`
- `docs/runbooks/search-security-hardening.md`
- `docs/runbooks/song-search-fuzzy-distance-index.md`
- `drizzle/0034_song_search_fuzzy_distance.sql`
- `drizzle/meta/0034_snapshot.json`
- `drizzle/meta/_journal.json`
- `playwright.local-supabase.config.ts`
- `src/app/api/public/songs/search/route.ts`
- `src/app/api/s/[token]/songs/search/route.ts`
- `src/app/api/session/[code]/songs/search/route.ts`
- `src/components/public/session-request-page.tsx`
- `src/db/schema.ts`
- `src/server/catalog-discovery-cache.ts`
- `src/server/session-api/rate-limit-core.ts`
- `src/server/session-api/rate-limit.ts`
- `src/server/session-api/service.ts`
- `src/server/song-search-admission.ts`
- `src/server/song-search-single-flight.ts`
- `src/server/song-search-unicode.ts`
- `src/server/song-search.ts`
- `tests/e2e/local-supabase-fixture.ts`
- `tests/e2e/run-local-supabase-smoke.ts`
- `tests/e2e/search-reliability.local.spec.ts`
- `tests/fixtures/song-search-unicode-baseline.ts`
- `tests/postgres/participantSongDiscovery.integration.test.ts`
- `tests/postgres/searchAdmission.integration.test.ts`
- `tests/postgres/searchIndexMigration.integration.test.ts`
- `tests/postgres/searchReliability.integration.test.ts`
- `tests/postgres/searchSecurity.integration.test.ts`
- `tests/postgres/songSearchAdversarial.review.test.ts`
- `tests/postgres/songSearchQuality.integration.test.ts`
- `tests/postgres/songSearchSqlApiUi.integration.test.tsx`
- `tests/postgres/unicodeSearchTimeout.integration.test.ts`
- `tests/postgres/unicodeSongSearch.integration.test.ts`
- `tests/sessionEventAccess.test.ts`
- `tests/vitest/catalog-discovery-cache.test.ts`
- `tests/vitest/search-rate-limit.test.ts`
- `tests/vitest/session-request-feedback.component.test.tsx`
- `tests/vitest/song-search-single-flight.test.ts`
- `vitest.search-reliability.config.ts`
