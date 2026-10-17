# Enterprise integration — collaboration, Fair Queue v2 and participant identity

Date: 2026-10-17. **PASS for the implemented integration in isolated PostgreSQL 17 and supported Chromium.** Production deployment is not authorised or certified by this report. Physical devices/WAN and actual event #46 replay remain unverified.

## Git and isolation

Original repository: `C:\Projects\pozanuta-stage-1`, branch `feat/kunestu-participant-model-fair-queue`. Audited base `703c145dc21a2b1eb58370a93058402ffbb4f48b`; retained foundation `721a1dd35caec0666d099024a344628c6e075c1c`.

The exact 46-file Collaboration manifest was reviewed, separated from two older changes and committed locally as **`437a4c0fd280a4806896cbbe0bd6836bf70c09af`**, `feat: checkpoint multi-operator queue collaboration`. No blanket staging or remote operation. Original worktree retains the private `.codex/config.toml` and pre-existing `docs/features/kunestu-production-readiness.md` modifications outside that commit. Config baseline SHA256: `b3129521d573035ce05bc8ae85086fe3f3a25093fc26e69d9c72b440f4c4291b`.

The already-existing managed Fair Queue worktree was clean at the original base; no interrupted v2 implementation was found there. It was reused, not duplicated: `C:\Users\michas\.codex\worktrees\fair-queue-v2\pozanuta-stage-1`, integration branch `michal-szwindowski/kunestu-enterprise-integration`, based on the Collaboration checkpoint. New changes live only in this worktree. Git common directory is `C:\Projects\pozanuta\.git`; the main checkout files were not edited. Unrelated repositories, pre-existing Docker stacks, restore clones, backups, private files and earlier artifacts are untouched. Disposable PG17 fixtures and dedicated Supabase E2E ports are the only mutated databases. No cloud credentials were copied into this worktree.

## Integrated architecture

The [Collaboration checkpoint](queue-collaboration.md) remains the protocol: immediate local projection, durable browser-scoped intention log, up to four independent writes, explicit same-source/anchor/start conflicts, UUID receipts in the transaction, revision/gap-aware invalidation, canonical snapshots and retained failed intentions. Fair Sort remains an explicit whole-queue barrier; ordinary network writes do not lock the entire UI. Browser identity is correlation metadata, never permission.

The [v2 ADR](../architecture/adr-fair-queue-v2.md) defines immutable completion history, ordinary completed rounds and a separate frozen-roster protection lane. The baseline algorithm is preserved behind the default `legacy` selector. `rotation-v2` is enabled only in the disposable test runner. Full Sort and Insert share deterministic preference; Insert preserves all existing pairs. Explanations, admission observations and completion provenance are recorded in private audit. Unknown historical acceptance/completion times are not invented.

The [identity read model](participant-identity-nickname-consistency.md) separates current nickname, original request snapshot and actual observed rename history. Rename is presentation only: snapshot revision changes, request semantic versions and drag structure do not. Merge changes canonical ownership and fairness, preserving performance and waiting facts by request IDs. Finish/cancel are domain operations; Fair Sort is an algorithmic whole-queue operation. All four semantics retain RBAC, event isolation, capacity 2/2 and atomic receipts/audits.

## Policy comparison and scope limits

See [reproducible synthetic comparison](fair-queue-v2-comparison.md). Baseline, least-served fair-share and hybrid are compared with twelve common workload/execution-model combinations plus half/double-cycle sensitivity. There is no available authorised event #46 timeline; **historical replay not performed**. Fixed three-minute service slots are simulation inputs, never runtime heuristics. Counterfactual behaviour is not described as actual human decisions.

The hybrid is not an empirical universal winner. Fair-share can starve returning songs under continuous newcomers; its excellent served-only latency hides 540-minute censored waits in this workload. Hybrid protects heads after a frozen observed cycle, but raises some maximum/later waits. Activation therefore remains an explicit product/release decision, not an implicit production flag change. Manual order and overload prevent unconditional waiting-time guarantees.

## Migration and safe recovery

Sequence: existing migrations through 0031 → `0032_queue_collaboration.sql` → `0033_participant_presentation.sql` → compatible application. 0032 was already included in the isolated Collaboration checkpoint; 0033 adds only restricted presentation/audit trigger behaviour. No destructive conversion or domain backfill. Current Drizzle journal and generated snapshots are included. Disposable fresh migration and populated 0032→0033 preservation tests are distinct from a production migration approval.

Future release requires a separately verified target, migration history/hashes, backup and restore evidence, exact scope approval and a named rollback application. Keep additive schema and facts on rollback; never erase receipts/confirmed performances or run destructive DOWN SQL. Switch `KUNESTU_FAIR_QUEUE_ENGINE` back to `legacy` for algorithm rollback; existing previews become stale. Old application code cannot promise the newer collaboration/history contract. Domains/URLs and all remote flags remain unchanged by this work.

## Verification ledger

Historical Collaboration results (414 Node, 682 Vitest, 74 PG17, 25 E2E) remain historical. They are not reassigned to this integration. Fresh commands, exact outcomes and measurements are recorded below. Logs are retained under ignored `.artifacts/`; traces under ignored test results. These are evidence, not commit candidates.

Observed and fixed during this integration:

- Presentation counting accidentally treated approval audit as completion; corrected exact action predicate, regression verifies approval/rename leave count zero.
- A new queue mutex on rename broke two contention tests; removed the unnecessary lock and preserved original assertions.
- Older tests expected restoring a completed request to erase its count; changed only that obsolete semantic expectation, retained active-count/status assertions.
- Full sort audit now records selected engine; exact audit assertions include it.
- Guest audit assertions retain all 11 original action counts and additionally require exactly one admission and two completion facts.
- A new upgrade fixture initially violated the existing public-ID format; fixed synthetic fixture ID, without relaxing the constraint.
- First rename browser run failed an overly broad 5-second measurement (full form→both panels 5886 ms). A later run measured full form 5172 ms and acknowledgement→both panels 109 ms. These are separate boundaries; the earlier failure is retained. No claim of a sub-5-second full-form interaction is made.

Additional defects addressed before the final verification image:

- Historical done/restore actions were initially missing from the new completion projection. A shared version-deduplicated reader now preserves those actual facts and unknown-date observations in both statistics and fairness. New confirmation/action audit pairs count once.
- Presentation invalidation initially did not reuse the Collaboration transaction marker; 0033 now coalesces queue/rename changes while retaining each real rename audit.
- Card explanations now describe priority at approval, rather than falsely explaining a later manual position. Manual reapproval clears an older automatic explanation.
- New E2E setup needed unique peer usernames, hydration-aware selection of the visible board, waiting for completed sign-in navigation, and opening the mobile queue drawer through the header. Failed runs/traces remain retained. Fixture cleanup is guaranteed even if browser closing fails, so a timed-out language test cannot leave duplicate synthetic songs for the next scenario.
- Intermediate typecheck failures in new tests (Testing Library versus Playwright selector options and server Date versus wire DTO) were repaired without weakening types or runtime assertions.

Required final commands: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `git diff --check`. The build runs through the actual project command inside verified disposable E2E configuration; its narrow build path never loads cloud `.env` files and has a negative socket test. No fabricated cloud environment bypass is used. Browser/DB tests must not run against existing environments.

## Unexecuted acceptance and production restrictions

- Physical tablet/phone touch, Safari, native screen reader and WAN latency remain manual checks, not PASS.
- In a synthetic isolated event on real devices: rename before/after approval, during performance and drag; verify both operators and public queue; cancel before confirming reject/cancel-performance; finish/restore; confirm names, counts and identity across reconnect and a consented merge.
- Two real operator devices: independent rapid moves, contradictory same-song/start actions, Fair Sort barrier, lost acknowledgement, offline pending intentions and explicit conflict recovery.
- Review the v2 protection policy and synthetic regressions before approving activation. Actual event #46 replay requires an authorised read-only export/connector, not guessed data.
- No production readiness/backup/migration/deployment claim is made. Nothing here authorises production changes, push, DNS/alias changes or touching active participants.

## Reproducing the isolated checks

Use this integration worktree/branch, inspect its diff and final `.artifacts/integration-*` logs; do not restart or overwrite the original worktree. The scoped local integration checkpoint contains the complete manifest and verified implementation. Its SHA is reported in the task handoff and ignored checkpoint evidence; obtain it with `git log -1` on this integration branch. Never count unfinished browser runs as PASS. No remote action is required to continue.

## Historical-data boundaries and operational risks

Only observable performance facts are counted: actual done audits, explicitly observed done source states, new completion confirmations and otherwise unrecorded current done rows. Dates absent from old evidence remain absent; an observation is used conservatively for future waiting, not advertised as a past performance date. Missing original logs/states cannot prove a physically performed song. No historical nickname is inferred from a request snapshot. The existing event #46 timeline was not accessed or simulated as actual history.

Receipts and event audit projections grow with event activity; long-term retention and much larger real-event workloads are not certified by the 100-card browser measurement. Cold offline navigation still requires loading the application; the durable intention log does not make this an offline PWA. Web Locks/IndexedDB support and a valid authorised session are required. These are scope limits, not hidden success claims.

## Tools and service boundary

Local Git, PowerShell, pnpm/Node, Docker PostgreSQL 17, pinned Supabase CLI with disposable local Auth/Realtime, Vitest and Playwright Chromium were used. Codex managed worktree tooling was used only for the existing local checkout. Official [Broadcast documentation](https://supabase.com/docs/guides/realtime/broadcast) and the Supabase changelog were consulted; the markdown changelog needed a plain HTTP fetch because the web reader rejected its content type. No Supabase remote MCP, Vercel, GitHub, DNS or production application operation was performed.

Final mathematics regression: an explicit counterexample showed that minimum-inversion insertion could place a newcomer before a protected head when older pairs opposed rank. The failing unit result is retained in `.artifacts/integration-protection-insert-counterexample.log`. The insertion floor now stays after protected initial heads without reordering any existing pair. The reproducer passes, and an actual PG17 approval test verifies the same persisted order. No threshold constant or baseline-engine math changed. The final targeted Fair browser verification follows the broad 27-scenario image; these runs are reported separately rather than relabelled as one new full run.

## Final verification ledger

All results below were executed locally on 2026-10-17. Earlier failed attempts are retained and are not counted as passing runs.

| Check | Result | Evidence in ignored `.artifacts/` |
|---|---|---|
| `pnpm test` | 430 Node / 686 Vitest PASS | `integration-final-test.log` |
| `pnpm typecheck` | PASS | `integration-final-typecheck.log` |
| `pnpm lint` | PASS, zero warnings/errors | `integration-final-lint.log` |
| Actual `pnpm build` with isolated optimized configuration | PASS | `integration-legacy-browser.log` and `integration-protected-insert-browser.log` |
| Public/session/identity/Presence/linking/merge/Fair Queue/driver faults PG17 | 54/54 PASS | `integration-final-image-public-postgres.log` |
| Collaboration, negative paths, populated migration upgrade and final protection-floor persistence PG17 | 22/22 PASS | `integration-protected-insert-postgres.log` |
| Contention / timeout hierarchy / guest queue PG17 | 4/4 + 3/3 + 2/2 PASS | `integration-final-image-contention.log`, `integration-final-image-timeouts.log`, `integration-final-image-guest.log` |
| Broad optimized browser matrix, including EN/UK mobile-sized sessions with PL operator | 27/27 PASS | `integration-final-image-browser.log` |
| Final `rotation-v2` Fair scenarios after protection-floor fix | 3/3 PASS | `integration-protected-insert-browser.log` |
| Final `legacy` fallback with same application/identity protocol | 3/3 PASS | `integration-legacy-browser.log` |
| Pure generated properties | 150 generated snapshots plus explicit counterexamples PASS | `tests/fairQueueV2.test.ts`, included in Node total |
| Drizzle snapshot/journal | 0033 parent points to 0032; unchanged table schema; unique indices PASS | local static comparison and PG upgrade test |
| Working and staged whitespace checks | PASS | checked before local checkpoint |

PG total: **85/85** across the listed suites. Browser counts are overlapping reruns, not 33 unique scenarios: the full matrix has 27 scenarios. The broad image precedes the final, narrowly scoped protected-insertion floor; that changed mathematics was then rerun in pure tests, an actual PG17 persisted counterexample, and the three relevant Fair browser scenarios. Unchanged browser-path results retain their original execution time. No prior-session result was assigned a new date.

The full browser matrix covers independent/contradictory moves, multiple dependent DnD before acknowledgement, two accounts and same-account devices, copied tabs, start/start, done, lost acknowledgement/idempotent receipt, offline persistence/reload/reconnect, stale snapshots, remote changes during gestures, Fair Sort barrier, cancellation confirmation, first/count/history semantics, actual nickname updates during a gesture and pending HTTP, public Realtime, capacity 2/2, Presence, linking/merge, event closure/old-tab restrictions, accessible keyboard/Escape, pointer geometry and emulated touch/scroll/orientation. Database tests add actual rename after merge, preserved original snapshots, private-audit rollback and browser-role denial, old explicit/implicit completion evidence and no duplicate confirmation counts. No physical-device or Safari test is claimed.

## Measured responsiveness

Captured UTC `2026-10-17T16:56:49.967Z`; optimized Next.js 16.3.0, Node 24.19.0, Windows, AMD Ryzen 7 5700X3D (16 logical CPUs), 32 GiB RAM, headless Chromium, real disposable Supabase Auth/Realtime/PG17. Browser Supabase engine was verified as PostgreSQL 17.6. Dedicated harnesses use `postgres:17-alpine`, with enforced PG17 major checks. Other existing local stacks were left running; this is not a dedicated performance lab or a production SLA.

| Approved synthetic requests | Local render frame p95 ms | Action start → HTTP 200 p95 ms | Action start → peer convergence p95 / max ms |
|---|---:|---:|---:|
| 20 | 29.7 | 354.7 | 441.6 / 441.6 |
| 50 | 38.2 | 329.6 | 474.0 / 474.0 |
| 100 | 89.3 | 505.0 | 908.3 / 908.3 |

Ten alternating moves per size. Local latency is native capture-phase click to a requestAnimationFrame observing the changed visible DOM, not physical paint/input latency or FPS. Acknowledgement and peer timings start before the Playwright action, so include automation/scroll/locator overhead. Peer checks also wait for confirmed response and use 10/25/50/100 ms polling intervals **inside the test**, not application polling. Nearest-rank p95 with ten samples equals the maximum. Budgets: local <=100 ms; acknowledgement/peer p95 <2000 ms; peer max <=5000 ms. All pass. These workload cards are synthetic legacy rows; 100 expanded participant histories, WAN and physical tablet rendering are not certified. Raw samples are in `integration-final-image-browser-metrics.json`.

The same run measured rename acknowledgement → both operator panels at **130.2 ms**, and full open/fill/save/observe phone form at **5194.2 ms**. These boundaries must not be conflated; no sub-five-second full-form PASS is claimed. Latest targeted v2 Fair apply → public refetch measured **208 ms**; fallback `legacy` measured **223 ms**. They are individual local observations, not p95 production guarantees.

The final pure-engine experiment (sort plus insert, ten samples, at most two active songs/identity) measured p95 **0.096 / 0.576 / 1.145 / 64.329 ms** at 20/50/100/1000 requests. A thousand rows represent 500 synthetic identities. This excludes DB, network and DOM; it is not a 1000-card browser result. [Comparison](fair-queue-v2-comparison.md) records all twelve scheduling/execution combinations, censored requests and threshold sensitivity. Mean equality can follow fixed service/admission conservation; tails and unserved groups determine the tradeoff. There is no universal-winner claim.

## Checkpoint, verdict and remaining acceptance

Exact cohesive task files and implementation/test checksums are in [the manifest](enterprise-integration-files.json). All files are based on the 46-file Collaboration checkpoint; the read model, completion projection, DTOs, v2 engine, migration 0033, catalogs and tests must be kept together. No unrelated configuration, data directory, log, trace, backup, environment file or generated build is a commit candidate. The added-content/new-file credential-pattern scan passed; this is a scoped review, not a claim that every possible secret format can be recognised automatically. Original protected file hashes and Git status are checked again before commit.

| Area | Verdict and scope |
|---|---|
| Realtime Collaboration / Enterprise DnD | PASS in the tested isolated supported browser environment |
| Fair Queue v2 | PASS for the specified deterministic/conditional protection contract; product tradeoffs explicitly documented |
| Participant identity/nicknames | PASS for preserved/observable historical facts and tested canonical-merge/rename flows |
| Integrated PL/EN/UK public session | PASS for the actual tested mixed-language session; prior UI architecture retained |
| Controlled isolated acceptance | GO using owned disposable PG17/Supabase fixtures |
| Production | NOT AUTHORISED; no production GO, migration, backfill, flag change or deployment performed |

Before broader use: execute the physical-device/WAN checklist above, review the protection policy and simulation limits, and separately authorise any existing-target backup/restore/migration/release plan. `KUNESTU_FAIR_QUEUE_ENGINE` defaults to `legacy`; `rotation-v2` was selected only for disposable tests. Changing the flag invalidates previews. No existing event was used. No new large module/stage is proposed by this handoff.

Final staging found CRLF trailing-whitespace errors in two new files that an unstaged-only diff cannot inspect. Only `0033_participant_presentation.sql` and `fair-queue-engine.ts` were normalised to LF; SQL/TypeScript tokens and logic are unchanged, no global Git attributes/settings were relaxed. Manifest checksums were refreshed and the complete staged check and PG17 migration/collaboration suite rerun before commit.
