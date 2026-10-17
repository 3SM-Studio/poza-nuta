# Enterprise Realtime Connection Resilience

Date: 2026-10-17. Working base: `9c5d86d9c4cfc00d4f931906af54e2f78aa6f0e3` on the existing enterprise integration worktree; checkpoint branch `michal-szwindowski/kunestu-realtime-resilience`. This change preserves Collaboration, Fair Queue v2, Participant Identity, foundation `721a1dd35caec0666d099024a344628c6e075c1c`, and the original checkout’s two private/unrelated modifications. No deployment, push, existing-database migration or production write is authorised or performed.

## Evidence and root cause

Confirmed in the previous hook: rejected initial `setAuth()` and terminal `CLOSED` only set `unavailable`; no application recovery was scheduled. Non-terminal errors relied entirely on SDK rejoin. There was no bounded recovery watchdog or guarded heartbeat worker. Responsive duplicate mounts could request the same topic from a singleton SDK without an application subscription owner. The collaboration controller separately refreshed on every focus, including repeated focus events. These are implementation defects or missing protections, not evidence of the trigger of any particular production incident.

The historical production deployment record is `dpl_2HM5HjWHffVM7zH76BUMngXbx85V`, SHA `703c145dc21a2b1eb58370a93058402ffbb4f48b`. A fresh read-only Vercel API request, including the linked team scope, returned HTTP 403. Therefore its continued production assignment is **not freshly verified**. That commit and the current worktree pin `@supabase/supabase-js` 2.110.0 and `@supabase/ssr` 0.12.0. The installed Realtime SDK is 2.110.0 with Phoenix 0.4.4. No remote Supabase access was necessary.

Chrome background throttling, OS sleep/discard, network loss, token lifecycle and remote service interruption remain possible triggers. Neither successful historical HTTP 101 handshakes nor this local reproduction identify the cause of the owner’s original Windows incident.

## Lifecycle and architecture

Before: `initializing → SUBSCRIBED → error/unavailable`; only SDK rejoin or remount/F5 might recover, and failed initialization/terminal close could remain unavailable.

After: `connecting → SUBSCRIBED/live → recovering → SUBSCRIBED/live`, with `unavailable` while offline, after prolonged failed recovery, or when Auth deliberately suspends the old actor. Recovery continues with bounded backoff while the route is mounted and online. Snapshot failure is a distinct data synchronisation error in the existing panel; a live socket alone does not confirm current data or a mutation.

`realtime-transport.ts` owns one transport/heartbeat worker per browser SDK client and one reference-counted private subscription per topic. Separate documents remain separate clients. It serializes channel retirement before re-creation, gives SDK rejoin a chance to succeed, invalidates retired callbacks using generations, and applies a 12-second initialization/join watchdog. Exponential delays use 0.8–1.2 jitter around 1, 2, 4, 8, 16 and capped 30 seconds (maximum actual delay 36 seconds). A sustained live period resets the next error budget; a flapping immediate join does not reset it on every attempt.

Only `SUBSCRIBED` marks a channel live. `CHANNEL_ERROR`, `TIMED_OUT`, terminal `CLOSED`, initialization failure and heartbeat failure enter recovery. An explicit offline event pauses channels, invalidates late initialization and disconnects this document’s SDK socket, stopping Phoenix’s independent reconnect timer. New joins await an in-flight disconnect before rejoining online. A failed test traced four SDK socket attempts before online; the correction preserves the <=3 recovery-socket budget instead of widening it. `online`, `focus`, `pageshow` and visible `visibilitychange` wake unhealthy subscriptions. The 15-second resume throttle limits data refresh, never suppresses recovery after a brief offline period. Worker task gaps also detect resumed JS without assuming Windows always emits `visibilitychange`.

Auth callbacks never await Auth APIs inside the SDK lock. Same-user token renewal permits ongoing SDK auth/rejoin. Logout or an observed different account suspends operator channels, cancels their recovery and rejects late auth completion. A participant-only document retires its previous channel and may rejoin using fresh anonymous/current Auth, without changing its independent HttpOnly participant identity; a positive public-topic regression guards against permanently blocking it. A changed actor requires normal route/controller re-initialization; it cannot replay the preceding actor’s outbox. Local RBAC, RLS, private channels and HTTP authorization are unchanged.

## Heartbeat and CSP

The exact installed SDK supports `worker`, `workerUrl`, `heartbeatCallback`, `onHeartbeat`, `heartbeatIntervalMs`, `heartbeatTimer` and `sendHeartbeat`. However `worker:true` disables Phoenix’s ordinary heartbeat timer and its startup/error path can throw or disconnect without restoring that timer. Its default worker also creates a blob URL. We deliberately retain the ordinary SDK timer and supplement it with one guarded same-origin `/realtime-heartbeat-worker.js` per active client. The worker only posts a heartbeat tick; it receives no URL, token, user data or queue data.

The main thread skips a supplemental send if a heartbeat was recently sent. Before a due supplemental send it clears the scheduled SDK send: otherwise a closely following second send with an ACK pending could manufacture a heartbeat timeout. Phoenix schedules its normal fallback again on ACK. Missing Worker, synchronous construction failure and asynchronous CSP/script error terminate the worker and leave the ordinary timer and connection recovery available. No CSP relaxation, blob permission or third-party worker is required. Final release terminates the owned worker, listeners and channel. This is not a Service Worker or offline navigation implementation; a completely frozen/discarded document cannot execute JavaScript until resumed.

## Snapshot, outbox and domains

A successful subscription/re-subscription fetches an authorised canonical API snapshot. Revision gaps still refetch; only API revisions are trusted. Missed Broadcasts are recovered by the snapshot, never assumed to be replayed. The existing controller reconciles receipts, keeps pending intentions and replays safe optimistic operations. A changed structural snapshot cancels a stale gesture; an unchanged reconnect does not. This patch does not change operation IDs, idempotency, source/neighbor CAS, start/done semantics, fairness, 2/2 limits or identity/nickname data.

The unthrottled collaboration focus listener is removed in favour of the transport lifecycle. Snapshot errors propagate to the hook’s separate bounded retry (1/2/4 seconds) while existing data/error UI remains visible. Successful fetch cancels a scheduled retry. A stream that is live while the API is unavailable still displays the panel’s synchronization error. No database query polling is introduced. Silent loss cannot be detected at the exact physical instant: until SDK timeout/close or a resume signal, status reflects the last server-confirmed join/heartbeat. Detection includes the configured heartbeat interval and reply timeout; the report does not promise instantaneous failure detection. Duplicate responsive views share the channel and existing collaboration writer; their refresh requests still use the controller’s existing in-flight coalescing.

Topics remain `dashboard:event:{eventId}:queue`, `dashboard:event:{eventId}:participants`, and `public:session:{publicToken}:queue`. They remain private. Broadcast fields and RLS are unchanged: type, operation/event where applicable, changedAt, and validated queue revision. No business-table browser reads, participant payload broadcasts, new API route or schema change.

## Safe diagnostics

Opt-in memory-only API available in a queue tab:

```js
window.kunestuRealtimeDiagnostics.enable()
// Reproduce, then obtain only the bounded safe report:
window.kunestuRealtimeDiagnostics.report()
// Stop collection and clear the retained events:
window.kunestuRealtimeDiagnostics.disable()
```

The random tab UUID is unrelated to Auth/device/participant identities. Reports contain enum event types, attempts, timestamps, visibility/network flags, heartbeat age, last successful dashboard API snapshot age, and counters. Snapshot age stays unknown when no confirmed dashboard read has occurred; callback completion is not treated as proof of a read. SDK failures are classified to authorization/timeout/network/unknown; the `auth_error` marker denotes a failed initialization wrapper and is not, by itself, proof of invalid credentials; raw errors/messages, topics, JWTs, emails, cookies, actor IDs and payloads are never accepted into the event buffer. Retention is at most 100 events and 30 minutes, pruned on insert/report. Nothing is sent to telemetry, printed automatically or persisted. Counters are cumulative attempts/subscriptions/worker starts, not inferred server billing or physical socket counts; E2E counts physical WebSocket creations separately.

## Verification ledger

Final common image and separately identified stress evidence; no historical result is assigned a new execution date:

| Check | Result | Evidence |
| --- | --- | --- |
| Full Node + Vitest on final source | **430 Node + 709 Vitest PASS**, including 29 hook tests | `.artifacts/resilience-test-checkpoint.log` |
| Typecheck / lint | **PASS**, 0 lint errors/warnings | `.artifacts/resilience-{typecheck,lint}-checkpoint.log` |
| PostgreSQL 17 collaboration / presentation | 22 PASS | `.artifacts/resilience-postgres.log` |
| PostgreSQL 17 public / identity / fairness / Presence / driver faults | 54 PASS | `.artifacts/resilience-public-postgres.log` |
| PostgreSQL 17 contention / timeouts / guest | 4 + 3 + 2 PASS | `.artifacts/resilience-{contention,timeouts,guest}-postgres.log` |
| Optimized `pnpm build` on final runtime | PASS | build stage of `.artifacts/resilience-browser-release-image.log` |
| Full browser suite on final runtime | **31/31 PASS**, 11.3 minutes | `.artifacts/resilience-browser-release-image.log` |
| Short-JWT resilience / Presence / outbox / receipts | 7/7 PASS | `.artifacts/resilience-browser-final-offline.log` |
| Working and exact staged diff | PASS (rechecked at checkpoint) | `.artifacts/resilience-staged-review.diff` |

Server and migration sources are unchanged by this transport task. All database tests used fresh owned PostgreSQL 17 fixtures, including existing migrations; no existing database was migrated.

Failed/intermediate attempts remain in ignored artifacts and are not counted as PASS:

- Initial unit adapters lacked the new Auth/heartbeat mock surface; a timer mock also initially mixed browser number and Node Timeout types. Their explicit types/interfaces were corrected without weakening product checks.
- The first full 120-second-JWT matrix had 17 passes, 2 failures and 12 not run. The trace showed the requested approval committed, while a nickname/first-row test lookup was not an unambiguous oracle. The lifecycle fixture now uses a distinct valid-length nickname and checks the immutable request ID. The rapid-DnD helper now waits for the exact indicated position and actual local result, retaining the required three operation IDs. An unexpected SDK refresh-fetch error was captured during intentional teardown/offline coverage; existing console assertions were not filtered away.
- The following standard full attempt had 24 passes, 2 failures and 5 not run: the newly distinct test nickname exceeded the form limit, and the new lost-frame proxy initially had no proof of a dropped frame. Product validation stayed unchanged. The corrected canonical lifecycle then passed independently, as did desktop, emulated touch and theme coverage.
- The proxy initially recognized JSON text only; installed SDK Serializer inspection and the trace proved that Broadcasts arrive as binary kind 4. The test now identifies only that envelope kind without retaining/logging its payload. It proves a lost Broadcast while online, then enters offline/CDP freeze.
- That stronger test exposed a real defect: four SDK socket attempts occurred before online and the <=3 recovery-socket budget failed with 5 creations. Explicit offline now pauses channels and disconnects this document's SDK socket, preventing its independent retry timer from running. The budget was retained.
- Chromium `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` blocked the CSP-intercepted loopback WebSocket before any frames. Only that disposable localhost context receives the documented local-network-access permission; no application security policy is disabled. CSP still blocks the worker in that case.
- Windows .cmd parsing caused no-test/wrong-selection runs. Playwright now runs via the installed JS CLI and direct Node argv; only actual .cmd/.bat tools use cmd.exe. Selected-test counts are checked explicitly.
- A typecheck overlapping harness cleanup saw disappearing generated `.next-p3-e2e` declaration files; final checks run after cleanup. Successful runs do not erase the failed logs/traces.

## Performance methodology and current measurements

Optimized Next.js 16.3.0 / Supabase JS 2.110.0, headless Playwright Chromium 149, Windows 11 Pro 10.0.26300, Node 24.19.0 / pnpm 11.7.0, Ryzen 7 5700X3D (16 logical CPUs), 32 GiB RAM, loopback Auth/Realtime and PostgreSQL 17. Fresh performance capture UTC `2026-10-17T18:39:30.330Z`, `.artifacts/resilience-performance-final.json`. Ten alternating approved-row moves per size; nearest-rank p95 is the maximum with ten samples. Local latency is native click to a rendered changed DOM observed on the next animation frame; it is not physical paint, FPS or real touch latency. ACK and peer latency start at Playwright action start and include automation/scroll/assertion overhead. This is localhost with synthetic simple cards, not a WAN or production SLA.

| Approved requests | Local render p95 ms | Server ACK p95 ms | Peer convergence p95 / max ms |
| --- | ---: | ---: | ---: |
| 20 | 23.2 | 295.2 | 391.2 / 391.2 |
| 50 | 52.8 | 415.8 | 562.6 / 562.6 |
| 100 | 93.8 | 411.3 | 736.1 / 736.1 |

All three measured sizes meet the existing budgets: local p95 <=100 ms, healthy peer p95 <2 seconds and max <=5 seconds. The 100-row local result is close to the budget; do not extrapolate to expanded profiles, slower hardware or a WAN. No speculative optimization was added. Participant rename ACK to both operators was 103.6 ms; the full mobile form was 5175.0 ms and is not presented as a sub-5-second result. Reconnect, idle-query counts, physical socket creations and short-JWT renewal measurements are recorded separately from these healthy-network move samples.

### Fault/recovery measurements

Captured UTC `2026-10-17T18:29:49.169Z` (exact timestamp and raw events in `.artifacts/resilience-expired-jwt-verified-metrics.json`). These are individual controlled faults, not a statistically estimated reconnect p95:

| Scenario | Observed result |
| --- | --- |
| One proven lost Broadcast, 130 s offline/CDP requested freeze, JWT TTL 120 s | Return to live/canonical queue 7452 ms; 1 new WebSocket, 3 snapshot GETs |
| Real socket close with held outbox write and active stale gesture | Recovery plus confirmed commit/convergence 1367 ms; 1 new WebSocket; pending intent retained |
| Missing heartbeat ACK with worker blocked by CSP | First dropped reply to live 26447 ms; after network-reply unblocking 27 ms; 2 new WebSockets; worker fallback recorded |
| 100 repeated focus/pageshow/visibility events after recovery | 3-second observation: no new subscriptions, 0 extra snapshot GETs |
| Two same-account tabs, CPU throttle 4x, roughly 87 s | 3 heartbeat replies/tab, 6 successful JWT renewals, 0 new WebSockets and 0 idle snapshot GETs; subsequent peer convergence 295 ms |

The final standard-JWT run independently measured 114 ms return to live/canonical state after a 70-second offline/CDP freeze, 1 new WebSocket and 3 snapshot GETs; real socket-close plus confirmed commit/convergence took 1773 ms; missing-ACK detection to live was 26440 ms with 1 new WebSocket. See `.artifacts/resilience-standard-final-metrics.json` (UTC `2026-10-17T18:43:16.365Z`). The longer short-JWT sample above includes expired-session renewal and is intentionally reported separately.

Both headless documents reported `visible`; this is not a real hidden-tab or Windows virtual-desktop certification. CDP requested frozen state and CPU throttling are controlled simulations; debugger/interception activity is not evidence of absolutely zero executed JS. The 130-second offline window exceeds the configured token TTL independently of that limitation, and subsequent authorized snapshot/private subscription recovery passed. Normal heartbeat timeout detection is included in the 26.4-second sample, rather than reported as a 27-ms end-to-end outage. Worker starts were one per document; unit tests verify termination/last-listener cleanup and delayed removal. These small local samples do not establish multi-hour reliability, memory-leak certification or a WAN SLA.

## Manual Windows acceptance — not performed

1. Use the isolated environment and a synthetic event. Open the same queue/account in two Chrome tabs on two real Windows 11 virtual desktops. Enable diagnostics separately in each.
2. Work on desktop A for 20 minutes, then multiple hours. On A approve, reorder, start, finish and Fair Sort; leave B untouched. Return to B without F5. Verify recovery, current canonical queue, no duplicate subscriptions and no obsolete green badge.
3. Repeat with two different permitted operator accounts. Verify pending independent intentions survive recovery; a conflicting source/start remains explicit and cannot overwrite the peer silently.
4. Disconnect/reconnect real Wi-Fi, sleep/wake the computer, use Chrome Memory Saver, return without relying solely on visibilitychange, and test a pending write and active DnD gesture.
5. Distinguish channel live from API snapshot failure. Capture the safe per-tab report before refreshing if recovery fails; note Chrome/Windows versions, elapsed background time and exact visible status, without copying cookies/network payloads.
6. Verify logout during reconnect never revives the old actor’s channel; perform new login through normal navigation. Check CPU/network usage over the prolonged test.

Automated CDP freeze/throttling, hidden-page simulation and headless tabs are not equivalent to physical virtual-desktop switching, real OS sleep or a multi-hour soak. Physical Windows acceptance remains unexecuted.

## Security and resource audit

- No authorization, RBAC/RLS, CSRF, API contract, queue transaction, catalog, domain or database schema edits. Private topics are retained; snapshots still go through the authorized server API. Production and persistent local development data are not used by the tests.
- Logout, changed account, late auth completion, retired callback, event switch and unmount are negative-tested. Reconnect cannot turn an unconfirmed outbox write into success. The existing server receipt/CAS safeguards remain authoritative even across account-cookie changes.
- No new credentials, env files, local/session storage, network telemetry, arbitrary worker URL or unbounded event logging. A scoped high-confidence secret-pattern scan and path audit found no credentials or temporary-artifact candidates in the task set; this is a scoped scan, not a claim of exhaustive secret detection in all historical commits.
- Resource bounds: one transport worker/client, one channel/topic, one join attempt/subscription at a time, 12-second watchdog, bounded exponential retry delays, 15-second resume-data throttle, at most three automatic snapshot retries per failure streak. There is no periodic queue fetch. Cleanup and delayed leave are covered by tests; an upgraded SDK must revalidate the heartbeat timer API and cleanup behaviour.
- Residual limitations: OS/browser discard and storage eviction cannot guarantee continued execution or persistence; reconnect happens when the document can run again. Multi-hour Windows desktop switching, physical sleep/Wi-Fi and production incident logs are not certified here. The 403 prevents a fresh production deployment-version attestation; it does not block isolated local verification.

## Release and rollback boundaries

No new migration or environment variable is required for this transport patch. The existing integrated base independently requires its already-prepared migrations 0032/0033; this task does not apply them to any existing database or assert that the older production schema is ready for the combined integration. Rollback of this patch is the previous integrated application code (`9c5d86d`) with the same additive schema; it does not delete data or revert SQL. Old deployed `703c145` is not automatically an equivalent multi-operator rollback. Future production rollout, database checks and any domain assignment require separate approval. No domain, DNS, alias, Vercel setting, production data or private local config is changed here.

External tools: local PowerShell/Python, pnpm/Node, Docker PostgreSQL 17/local Supabase CLI, installed SDK source, Vitest/Playwright, read-only Vercel API (403) Context7 documentation lookup and public documentation. No remote Supabase SQL/MCP, GitHub mutation or deployment tool was used.

References: [Supabase background disconnections](https://supabase.com/docs/guides/troubleshooting/realtime-handling-silent-disconnections-in-backgrounded-applications-592794), [Playwright WebSocket interception](https://playwright.dev/docs/api/class-websocketroute), [Playwright permissions](https://playwright.dev/docs/api/class-browsercontext#browser-context-grant-permissions). Supabase’s changelog was checked, including the future CBC TLS deprecation; it does not establish the cause of this incident.

## Exact checkpoint scope

The exact 21-file set and runtime/test SHA-256 values are recorded in [the manifest](realtime-connection-resilience-files.json). It excludes ignored logs, traces, generated builds, local databases, environment files and the original private modifications.

- `docs/features/realtime-connection-resilience-files.json`
- `docs/features/realtime-connection-resilience.md`
- `playwright.local-supabase.config.ts`
- `public/realtime-heartbeat-worker.js`
- `src/components/operator/event-queue-panel.tsx`
- `src/components/operator/use-queue-collaboration.ts`
- `src/components/realtime/use-queue-realtime.ts`
- `src/i18n/messages/en.json`
- `src/i18n/messages/pl.json`
- `src/i18n/messages/uk.json`
- `src/i18n/source-index.json`
- `src/lib/queue-realtime.ts`
- `src/lib/realtime-diagnostics.ts`
- `src/lib/realtime-transport.ts`
- `tests/dashboardOrganizationRouting.test.ts`
- `tests/e2e/public-event-session-identity.local.spec.ts`
- `tests/e2e/queue-collaboration.local.spec.ts`
- `tests/e2e/realtime-resilience.local.spec.ts`
- `tests/e2e/run-local-supabase-smoke.ts`
- `tests/vitest/event-queue-panel.component.test.tsx`
- `tests/vitest/use-queue-realtime.test.tsx`

## Final verdict and local checkpoint

**Automated functional/regression verification: PASS.** Final common runtime: 31/31 real-browser scenarios, all 430 Node + 709 Vitest checks, 85 relevant PostgreSQL 17 checks, optimized build, typecheck, lint and diff checks. Seven additional short-JWT/fault/Presence/outbox/receipt executions passed; these overlap the main suite and are not seven additional unique scenarios. Source/tests and the exact 21-file scope match the manifest. Root private configuration and the pre-existing readiness-document modification retain their initial SHA-256 values.

**Full Windows multi-hour Definition of Done: PARTIAL.** No real virtual-desktop, physical tablet, real Wi-Fi/sleep or multi-hour soak was performed; headless visibility stayed visible. The original production incident's trigger and current Vercel deployment assignment are not freshly confirmed (read-only API 403). The implementation fixes confirmed recovery/lifecycle defects and is ready as a verified local checkpoint, not as a claim that the production issue has already been observed fixed.

Local checkpoint message: `fix: recover realtime subscriptions after background disconnects`, branch `michal-szwindowski/kunestu-realtime-resilience`, parent `9c5d86d9c4cfc00d4f931906af54e2f78aa6f0e3`. The checkpoint SHA is supplied in the completion message/ignored checkpoint receipt; it cannot be embedded in its own committed content. There was no push, deployment, domain/configuration change, production write or existing-database migration. Temporary owned test containers and the 3105 application server are stopped; all earlier evidence/recovery artifacts are retained.
