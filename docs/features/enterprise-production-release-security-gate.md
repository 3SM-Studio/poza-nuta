# Enterprise Production Release Readiness & Security Gate

Audit date: 2026-10-18, Europe/Warsaw. Candidate base:
`372a9b9869a0f9df905142862352968c66160ef1`, branch
`michal-szwindowski/kunestu-search-reliability`. This report supersedes historical
unknowns only where a fresh read/test is explicitly identified. It does not rewrite
the earlier private production-readiness document.

**Decision: NO-GO for production execution now.** The application checkpoint has
credible local regression evidence. The event-scoping security fix is prepared
locally, not installed on production. A fresh backup/restore, a reviewed migration
window, and expiry/invalidation of previously authorized Realtime connections are
required release gates. No production mutation, deployment, push or new commit was
performed in this audit. Details and executable procedure are in
[the release runbook](../runbooks/enterprise-production-release.md).

## Actual Git and release image

Verified ancestry, rather than commit descriptions:

`721a1dd → 703c145 → 437a4c0 → 9c5d86d → 73bf9d0 → 372a9b9`.

All four enterprise checkpoints are ancestors of the candidate. The difference
from deployed `703c145dc21a2b1eb58370a93058402ffbb4f48b` is four commits and 119
files before this audit's local security/test/documentation delta. No package or
lockfile change occurs in that release interval. Node remains 24.x, pnpm 11.7.0,
Next 16.3.0, Supabase JS 2.110.0 and SSR 0.12.0. This is an integrated release,
not four unrelated cherry-picks.

Original checkout `C:/Projects/pozanuta-stage-1` remains on `437a4c0`, with only
the existing private `.codex/config.toml` and unrelated
`docs/features/kunestu-production-readiness.md` modifications. Their SHA256 values
were compared with the prior protected record and matched. No reset, clean, stash,
branch rewrite or backup deletion was used. Work continues in the managed worktree.
The prior source/test manifest and all 17 recorded search evidence hashes matched
before adding this audit's delta. Existing checkpoints and ignored logs remain.
Prior mutable JSON result files were copied into ignored
`.artifacts/release-gate-prior-evidence/` before the new full browser run could
overwrite their standard output filenames; the old source manifests retain their
original hashes/dates.

The proposed local commit is `fix: scope dashboard queue broadcasts to organization members`
(including its tests and release documentation); no commit is created here.

The new release delta is migration 0035 (policy-only), generated journal/snapshot,
scoped PG17/browser regressions and migration-window tests, Playwright inclusion,
and these documents. No fairness, DnD, Auth/session, URL or domain implementation
is rewritten. Exact paths/hashes are in the accompanying release-gate evidence
manifest. The snapshot adds no business schema objects: custom SQL policies are
represented by the migration, not Drizzle's public-table snapshot.

## Fresh production observations — read only

Capture started around 00:35 Europe/Warsaw on 18 October; raw UTC is retained in
`.artifacts/release-gate-production-readonly.json`. Values below are a point-in-time
observation, not an approval to use these targets for local tests.

| Item | Evidence / result |
|---|---|
| Vercel alias | `pozanuta.vercel.app`, existing project `pozanuta` |
| Serving deployment | `dpl_2HM5HjWHffVM7zH76BUMngXbx85V`, Production READY |
| Serving SHA | `703c145dc21a2b1eb58370a93058402ffbb4f48b` |
| Function region | deployment metadata `iad1` |
| Node | project metadata 24.x |
| Supabase | CLI metadata independently resolves `qwmimnhdnzqfckswxjww`, name `poza-nuta-development`, ACTIVE_HEALTHY, `eu-central-1` |
| SQL identity | PostgreSQL 17.6 (`170006`), database postgres, role postgres, transaction READ ONLY |
| Target check | owner designation, matching scoped pooler username/ref and Auth hostname; certificate-validated client TLS |
| TLS caveat | `pg_stat_ssl` for the database backend reports false: this is the pooler-to-database leg, not proof of plaintext client transport. Upstream enforcement remains unverified |
| Drizzle | 32 entries, every hash/timestamp matches local 0000–0031; pending 0032/0033/0034, plus new local 0035 |
| Catalog | 92,014 songs, 92,014 documents, 0 missing projections; no expensive production full-normalization comparison was run |
| Other aggregate counts | 45 events, 1,130 requests, 2 Auth users; no names/user rows read |
| Storage | 0 buckets, 0 objects in the fresh database read |
| DB size | about 195 MiB total; projection about 81 MiB. These are used bytes, **not free quota/disk** |
| Resources | max_connections 60; 7 client backends in the sample; no transaction over 1 minute; no ungranted sampled public relation locks |
| Advisory function | postgres can execute the built-in two-integer transaction advisory lock |
| Environment | Production SONG_SEARCH_ENGINE is `unicode-v2`; SITE_URL matches the canonical URL |
| Sensitive env | DATABASE_URL and NEXT_PUBLIC_SUPABASE_URL are present but not decrypted; owner target declaration remains part of attribution |
| Optional setup/invite env | Listed Production keys do not include SUPABASE_URL, an admin secret, AUTH_INVITE_COOKIE_SECRET or PLATFORM_SETUP_TOKEN_SHA256. Bootstrap/invite functions must not be assumed configured; no secret is added by this release |
| Fair Queue flag | no Production KUNESTU_FAIR_QUEUE_ENGINE entry listed; candidate default remains `legacy`; no automatic v2 activation |
| HTTP HEAD only | `/sign-in` 200, HSTS present, no CSP header; heartbeat worker 404 on old deployment, expected because it is new in 73bf9d0 |
| Logs | grouped 30-minute search for 57014/55P03 returned no groups; does not prove historical problems absent |
| WAF | active custom configuration read returned 404; managed platform protection is not thereby proven absent |

Native SQL used the existing privately stored administrative connection with
`default_transaction_read_only=on`, BEGIN READ ONLY, 15s statement and 1s lock
budgets. No application session, lazy-close route, seed or production load test was
run. The initial identity assertion incorrectly expected backend `pg_stat_ssl` to
describe the client-to-pooler TLS leg; it aborted before inspection. The corrected
check retained certificate validation and READ ONLY, and records both legs honestly.
Supabase project-scoped MCP was unavailable; generic Supabase MCP was not used.

## Confirmed security defect and minimal correction

The deployed dashboard queue SELECT policy matches a syntactically valid event
topic and `private.is_active_dashboard_operator()`. That function verifies the
Auth-linked active, non-suspended operator, but **does not verify membership in
the event's organization**. Event IDs are numeric; their obscurity is not a control.

An operator in organization A who knows/guesses a B event ID can receive B's
`dashboard:event:<id>:queue` invalidations. The current candidate payload exposes
`eventId`, stream `revision`, `operation`, `changedAt`, `type` (plus Realtime's technical message `id`): event existence,
activity and ordering frequency can be inferred. On deployed 703 the payload
predates stream revision, but still contains event ID, operation and time.
No singer, title, participant record, cookie or token is broadcast. The weak policy
does not grant business-table reads, cross-organization queue API access, or
INSERT/send permission. The participants topic already checks event membership.
Public queue access by possession of its 22-character capability topic remains an
intentional public-session contract, not an organization-membership check.

Migration `0035_dashboard_queue_channel_scope.sql` changes only the existing
dashboard queue SELECT predicate. It retains broadcast/type/topic checks and reuses
the reviewed membership helper `private.can_receive_event_participants`, mapping
the validated `:queue` suffix to `:participants`. No new role/grant/function,
business-table policy, identity rule or browser mutation permission is introduced.
Active workspace membership of owner/manager/operator/viewer may receive; the API
continues to restrict mutations to managers/operators/owners. Inactive membership,
workspace or operator, suspended actor, anon and malformed/unrelated topics fail.
Platform membership alone does not bypass organization scope, consistent with this
dashboard API. Event lifecycle is not a subscription permission: an organization
member may still inspect its closed event through the authorized API.

The PostgreSQL regression reproduces the old cross-organization read, applies 0035,
then checks actual RLS SELECT and denied INSERT, both dashboard topics, public topic,
all four membership roles and inactive/suspended cases. Its mocked auth/topic
functions are confined to the owned PG17 compatibility fixture.

Fresh real-Auth/WebSocket browser proof (18 October, optimized image): operator A
joined B under the old policy and received the exact minimal payload plus transport
message id. After applying 0035 its existing connection continued receiving until
rejoin; a fresh A→B join then returned CHANNEL_ERROR. B own queue and participants
channels and anonymous capability public queue remained SUBSCRIBED and received
real SQL-triggered invalidations. A→B canonical API returned 404. An acknowledged
forged broadcast did not receive a positive confirmation (timed out); neither the
owner nor public receiver observed its payload, while a subsequent canonical
invalidation delivered successfully. This is a bounded negative delivery check
plus the independent PG RLS INSERT denial, not an assertion based solely on SDK
local send status. Full integrated browser run: **33/33 PASS, 12.1 minutes**.

**Authorization cache is a release gate.** Changing the policy does not revoke
already joined sockets immediately. Supabase caches authorization until reconnect
or new JWT. The runbook must close/drain old connections via an approved service
procedure, or wait out a verified maximum JWT lifetime before declaring containment.
Refreshing only cooperative operator browsers is insufficient against an adversary.
Do not broaden the policy again as an application rollback.

Severity: confirmed medium confidentiality exposure (cross-tenant activity
metadata), P1 release blocker. There is no evidence here of cross-tenant participant
data disclosure or unauthorized queue writes. No claim is made that nobody used it.

## Migration safety and measured lock window

Production column layouts and index definitions matched the 0031 synthetic baseline.
A separate constraint comparison found three format CHECKs already VALID on
production but NOT VALID on a newly replayed migration chain. Their expressions
match after validating those same constraints **locally only**. This is recorded
existing history/state, not a reason to edit old migration hashes or revalidate
production blindly. Other business constraint definitions and Realtime predicates
then matched.

One local fixture attempt failed before pending migrations because its synthetic
organization public ID was shorter than the existing 20-character constraint. The
fixture was corrected; no validation/constraint was weakened. Another audit helper
had a syntax error before opening its fixture. Both failed logs remain preserved.

| Migration | Change / lock / compatibility |
|---|---|
| 0032 | Empty receipt/stream tables with RLS and revoked browser grants; NOT NULL intent_version DEFAULT 0 (constant fast default on PG17); FKs on empty tables; per-event transactional revision, intent trigger and minimal broadcasts. ALTER song_requests needs ACCESS EXCLUSIVE. Existing rows get version 0; no queue reorder/backfill. New code requires this before serving |
| 0033 | Rename audit/invalidation trigger, no invented historical aliases or source rewrite. CREATE TRIGGER briefly locks event_participants; calls 0032 stream table/marker |
| 0034 | Transactional expression GiST siglen=256; SHARE on projection blocks catalog source writes through trigger. It does not itself require a song_requests exclusive lock. Existing imports maintain the index; no backfill |
| 0035 | ALTER POLICY on realtime.messages; no business data rewrite. Existing helper comes from 0028. Old application also works with the tighter policy |

Drizzle 0.45.2 source was inspected: one invocation applies **all pending migrations
in one transaction**. Thus a single 0032–0035 run retains the early queue-table lock
through the index build. This is why an additive index alone is not a zero-downtime
description of the whole release.

Measured on owned PG17.10, 2-CPU Docker quota, Windows/Ryzen host, 92,014 synthetic
songs with the real projection trigger, 20 requests and an independent writer:

- Original full 0032–0034 rehearsal: 2,000ms including a deliberately held 200ms
  blocker, 35 final journal rows, valid index, all source songs/request fields
  preserved. Catalog SHARE allows a queue write (11ms sample), while a catalog
  update correctly hits a deliberately short 150ms lock timeout.
- A full pending 0032–0035 invocation under traffic held a queue exclusive lock
  while the index was built. A split official-runner experiment executes a vetted
  migration-folder prefix through 0033, commits, checks history, then runs the full
  unchanged folder. Both invocations still use Drizzle's own migrator and hashes.
  No hand-inserted production journal entries, modified existing migration SQL,
  CONCURRENTLY rewrite or schema push is proposed.
- Final combined run: 2,000ms wall time, 1,970ms maximum synthetic queue write,
  14 writes. Split run: queue-schema 171ms, index/policy 1,894ms, maximum queue
  write 107ms across 261 writes (including an extra deliberately failed index
  transaction). The index phase had zero observed queue-exclusive locks, with
  120 catalog SHARE samples. An injected division-by-zero after index creation
  rolled back the index and phase-2 history, left 34 phase-1 journal entries,
  then original files retried successfully to 36 entries. No data/status/position
  loss occurred. Full metrics and the fault are in
  `enterprise-release-gate-evidence.json`. These are local samples under
  artificial traffic, not a hosted outage-duration guarantee. Monitoring queries
  themselves add a little overhead.

The lock/load fixture uses the PG17 compatibility schema: its `realtime.send`
is a no-op, rather than a running broker/partitioned Realtime publication. The
measured queue write maximum therefore does not quantify contention on the real
`realtime.messages` service during ALTER POLICY. Real Auth/channel delivery is
verified in the separate local Supabase browser suite. This limitation is another
reason to retain the quiet-window/lock-timeout gate, not promise 107ms in production.

Selected plan: two verified Drizzle batches in an approved quiet window. Phase 1
commits through 0033; phase 2 runs 0034/0035. Stop catalog imports throughout phase 2.
Do not deploy new code between phases. If phase 2 fails, its index/history must
rollback and the old application continues against additive 0032/0033. Rerun only
after verifying history/objects. If there is no tolerable quiet window, NO-GO:
do not introduce an unreviewed concurrent-index migration under pressure.

Index size is data-dependent: about 13 MiB in the simple release fixture, about
18.85 MiB in the richer search benchmark. Free hosted disk, transient index-build
space, WAL headroom and available CPU/quota have not been measured. Before approval
reserve verified headroom against a current restore measurement; used database size
alone cannot establish it. No arbitrary promise of a 2-second production migration.

## Regions and latency

Vercel metadata confirms iad1 (US East); Supabase CLI confirms eu-central-1
(Frankfurt). An API request can make many sequential DB/Auth round trips. Search
admission, transaction begin/commit and query settings add trips even with an index.
This makes a WAN-sensitive service slower than its localhost SQL sample; raising
the SQL timeout would not eliminate transport latency or CPU contention.

There is **no direct measured iad1→Supabase RTT or fra1 before/after result** in this
audit: obtaining it would require a deployed probe or function configuration change.
No such probe was deployed. Inferring an exact millisecond saving from regional
names or the local browser test would be invalid. Code review shows at least permit,
settings and search statement plus transaction boundaries on an admitted v2 search,
before separate session checks. For illustration only, N serial round trips add
roughly N×RTT; this is not a measured API response estimate.

Safest regional proposal: one function region `fra1` on the existing project,
configured in a separately approved `vercel.json` change (`{"regions":["fra1"]}`)
or the project setting, **not both**, then inspect emitted function regions and
the serving deployment. This does not move Supabase or change DNS/domains/QR URLs.
Do not add multi-region writes/failover: Hobby supports a single region; actual
account entitlement must be verified before applying. Regional compute pricing can
differ. Static CDN, middleware and browser→Supabase WebSockets are not made regional
by that setting; middleware/Auth and external APIs still need smoke coverage.
Some Next route-level preferredRegion settings can override defaults: none is
introduced here. No regional configuration file or paid-plan change was made.

Region co-location is a recommended latency improvement with an unverified benefit,
not a substitute for the confirmed security/backup gates. After approval compare
bounded route latency, DB telemetry and 57014/55P03 before/after at the same traffic
level, not an uncontrolled production load test. Application rollback to the prior
deployment also returns to its original region/configuration snapshot.

## Backup and recovery gate

Existing backup `kunestu-prod-20261016-XqKlcD` remains outside Git, unchanged.
Snapshot UTC 2026-10-16T17:13:27.910Z. Fresh read-only verification successfully
unwrapped the DPAPI CurrentUser key, authenticated-decrypted all six core manifest
artifacts, and checked ciphertext and plaintext SHA256. It wrote no backup files.
The existing restore proof is dated 2026-10-16T17:21:08.968Z: 68 table counts/digests,
242 constraints, 33 role attribute sets, Auth and catalog reads, network-none PG17.6
clone. It is historical proof, not a fresh restore on this date.
Fresh ACL inspection also confirms protected inheritance and exactly two allowed
principals (current Windows account and SYSTEM), with no unexpected allow entries.

That snapshot predates production 0028–0031: 28 journal entries, 43 events, 1,066
requests and 1 Auth user; fresh source has 32 entries, 45 events, 1,130 requests and
2 Auth users. It cannot safely serve as the current pre-migration recovery point.
**A new consistent backup and actual isolated restore are mandatory before DDL.**
They are specified in the runbook, not executed by this audit.

Auth/public/private/storage/realtime/vault DB data and role definitions are in the
old dump; passwords of managed roles are excluded. Storage was empty then and is
empty in the fresh read; metadata is not a file-object backup. Historical Edge Functions/Vault secrets count was zero; a fresh scoped Supabase
CLI list on 18 October confirms zero Edge Functions. Current Vault secret count
and private provider settings were not re-read. Provider SMTP/OAuth/signing/encryption-root configuration and managed
password continuity must be retained privately. Same-project logical database
recovery was proven; complete recreation of all hosted services elsewhere was not.
DPAPI remains tied to this Windows account/machine; off-machine key escrow was not
proven. Preserve both key and ciphertext; arrange separately approved encrypted
escrow if resilience to machine loss is required.

## Security gate — warnings versus release blockers

| Finding | Evidence / risk | Minimal safe action |
|---|---|---|
| Cross-organization queue signals | Confirmed, medium/P1; candidate 0035 locally prepared | Ship tested policy with approved migrations; invalidate old authorization caches; never reopen scope as rollback |
| Business tables | Fresh 24 public tables: RLS on, no anon/authenticated DML grants | Preserve backend/API boundary; no broad SELECT policy |
| Queue writes | Actor/device receipt fingerprint, event/workspace guards, source/neighbor/start CAS and atomic audit | Preserve existing regression gates; no last-write-wins; operator browser refresh after rollout |
| Participants | HttpOnly random credential, hashed DB token, origin/body validation, scope checks | Preserve; no token storage in local/session storage. Outbox stores operations, not Auth/participant credentials |
| SECURITY DEFINER auto-RLS | Fresh definition: event_trigger, owner postgres, search_path pg_catalog, browser EXECUTE grants | Non-blocking least-privilege cleanup proposal: revoke EXECUTE only after dependency review/approval; direct invocation is rejected as event-trigger by PG. Not an arbitrary callable business RPC |
| Existing membership helpers | Fixed empty search path; explicit authenticated EXECUTE used by RLS | Do not revoke these required helpers or disable triggers/RLS |
| pg_trgm | 1.6 in public, owned by supabase_admin; browser roles cannot CREATE in public | Do not relocate during release; separate extension lifecycle review |
| Auth | Public settings 200: signup disabled, email enabled, autoconfirm false; private settings not exposed | Verify leaked-password protection availability/config, redirect list and JWT maximum in provider UI; no Auth setting/plan changed |
| HTTP limits | 120/minute/device, 2400/network, process-local; parallel/NAT tests pass | Residual distributed-abuse risk; inspect actual WAF policy before claiming global limits. Search advisory slots cap DB ranking concurrency, not all database work |
| CSP/worker | No CSP header on fresh sign-in HEAD; same-origin worker with ordinary timer fallback | No CSP relaxation needed; verify worker 200 after release. Broader CSP hardening requires separate compatible policy rollout |
| Secrets | No new browser credentials/config; task-path scan and protected hashes required at handoff | Never upload ignored local environments, traces, logs or backup; clean release directory only |
| PG patch level | Hosted 17.6; current official Supabase changelog announces 17.11 security fixes | Separate provider patch/restore compatibility review, not an automatic upgrade. No claim that application changes patch hosted PostgreSQL |

The supplied old report of disabled leaked-password protection is not a fresh
private-setting read. No unsupported Auth claim is converted into PASS. Provider
security advisories and available maintenance/patch schedule remain unknown.
Missing optional bootstrap/invite configuration is an existing scope limitation,
not a reason to enable setup or distribute an admin key. Use already authorized
operators for release acceptance; provision any new synthetic hosted account only
under its separate approved procedure. If invite onboarding is required for the
release, configure and smoke it separately before declaring that flow ready.

## Functional matrix and retained evidence

| Module | Local functional judgment | Release qualification |
|---|---|---|
| Collaboration / outbox / idempotency / snapshot reconciliation | PASS; fresh integrated 0035 smoke | No silent pending-intent discard on rollback |
| Realtime resilience / heartbeat / reconnect | PASS; fresh integrated 0035 smoke | No multi-hour real Windows desktop certification; authorization cache procedure mandatory |
| DnD / Fair Sort / legacy Fair Queue | PASS in recorded unit/PG/browser scopes | Old tabs must refresh into versioned-operation contract |
| Fair Queue rotation-v2 | PASS in isolated test scope | Remains OFF/default legacy on production; activation is a separate explicit decision |
| Identity / rename / linking / Presence / 2/2 | PASS; fresh integrated 0035 smoke | Own participants and public queue delivery retained |
| Public PL/EN/UK / Unicode / error retry | PASS; fresh integrated 0035 smoke | No real KaraFun relevance certification or physical-device PASS |
| Search capacity/cache | PASS on owned 2CPU synthetic workload | p95 4.39s for 20 distinct heavy searches; up to 60s category TTL staleness accepted only with monitoring |
| Hosted execution now | NO-GO | Fresh backup/restore, security containment, quiet migration window, disk/quota and owner approval |

Retained 17 October final evidence: 430 Node, 721 Vitest, 96 PG17 protocol/integration
tests, 32 optimized-build E2E, typecheck/lint/build/diff checks. These results were
hash-checked, not rerun or relabeled with today's date. Seven short-JWT/offline
resilience scenarios are separate historical stress evidence. Runtime/test manifest
match was proven before the new policy-only delta. Fresh results on 18 October: **430 Node / 721 Vitest**, **24 PG17 tests**
(2 new security/migration-window tests and 22 collaboration/presentation regressions
with the collaboration fixture upgraded through 0035), **33/33 E2E** on the actual
optimized `pnpm build`, and final typecheck/lint/diff checks. Details and evidence
hashes are recorded in the evidence/manifest files; no skipped physical test is PASS.

Fresh command ledger (ignored logs in `.artifacts/`):

| Command | Result | Log |
|---|---|---|
| `pnpm test` | 430 Node / 721 Vitest PASS | `release-gate-test.log` |
| `pnpm exec vitest run --config vitest.release-gate.config.ts` | 2 PG17 PASS | `release-gate-postgres-final.log` |
| `pnpm exec vitest run --config vitest.queue-collaboration-postgres.config.ts` | 22 PASS, collaboration DB through 0035 | `release-gate-collaboration-postgres.log` |
| Owned optimized E2E launcher, unicode-v2/rotation-v2, no grep/retries | build PASS; 33 E2E PASS | `release-gate-browser-final.log` |
| `pnpm typecheck` after launcher cleanup | PASS | `release-gate-typecheck-final.log` |
| `pnpm lint` after launcher cleanup | PASS, no new exclusions | `release-gate-lint-final.log` |
| `git diff --check` / empty staged diff check | PASS | final audit receipt |

Intermediate failures were not counted as PASS. A browser helper initially passed
an entire fixture object through serialization; it was narrowed to credentials.
A one-shot initial signal was not observed, so the owned test now waits for positive
transport readiness with bounded synthetic no-op writes, without adding application
polling or widening the timeout. Another assertion omitted the broker's technical
message id. The default SDK send returned local `ok` before server acknowledgement;
the test now explicitly requests ACK and checks actual negative delivery as well.
One lint run started too early and scanned transient generated Next chunks; it was
retained as failure and rerun after cleanup, without adding ignore rules or weakening
lint. Two unused variables in ignored helpers were removed. No production DDL or
unintentional migration failure occurred. Intentional index-phase fault injection
is an expected negative test, not a suppressed release failure.

Physical tablets, Safari/iOS, all IMEs, multi-hour two real Windows desktops and
WAN/cross-region latency remain NOT EXECUTED. They do not prove a defect and need
not block a small monitored release after hard gates pass, but this is not an
enterprise reliability certification. Scope initially to the owner and one explicit
test event. Do not mistake an expired event still marked active in storage for a
current active session; inspect effective lifecycle using autoCloseAt/closedAt.

## Smallest path to GO

1. Accept/review the local 0035 change and its negative/real-WebSocket regressions.
   Finish its current verification before creating any new release checkpoint.
2. Read the actual JWT lifetime and select an approved way to drain cached Realtime
   authorization. Confirm current disk/WAL/quota headroom and no running import.
3. Select a quiet production window and explicitly approve a **new** encrypted
   snapshot/roles/service-state backup plus isolated PG17/Supabase restore. Compare
   every required table/digest/constraint/role; never restore over the live source.
4. Approve the exact release manifest, two official Drizzle batches, existing-project
   Production deployment and test-event scope. No Preview and no domain changes.
5. Prefer the separately reviewed single-region fra1 setting, or explicitly accept
   iad1 WAN latency pending bounded measurement. Do not bundle a paid-plan upgrade.
6. Execute only after separate authorization, stop on any gate below, then perform
   the manual smoke/observation checklist before broad use.

This audit supplies a concrete plan and local correction. It does not grant itself
permission to deploy, change hosted roles/Auth, create a production test event, push
or activate rotation-v2.

## Sources and tools

Sources: local source and Drizzle migration hashes; Vercel read-only alias/deployment/
project/environment metadata and grouped logs; verified native READ ONLY PG17 query;
Supabase CLI project metadata and public Auth settings; local Docker/Supabase/Chromium
fixtures. No GitHub remote operation or generic Supabase MCP. Existing backup was
authenticated-decrypted only in memory, with no user-row output.

Official documentation consulted 2026-10-18:

- [Realtime authorization and cache lifetime](https://supabase.com/docs/guides/realtime/authorization)
- [PostgreSQL 17 locking](https://www.postgresql.org/docs/17/explicit-locking.html)
- [Vercel function regions and plan limits](https://vercel.com/docs/functions/configuring-functions/region)
- [Vercel region mapping](https://vercel.com/docs/regions)
- [Vercel rollback](https://vercel.com/docs/instant-rollback)
- [Supabase backup/restore scope](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase password security](https://supabase.com/docs/guides/auth/password-security)
- [Supabase 17.11 maintenance notice](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)

Documentation is guidance, not evidence of the account's private settings.
