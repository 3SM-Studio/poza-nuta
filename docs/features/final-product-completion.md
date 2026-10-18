# Final product completion before release

Date:2026-10-18. Base checkpoint:`ea7ac875da2572515c16b137b0196350490190e2` (includes Security Gate0035 and all prior modules). This is a local product-completion stage. No push, deployment, production migration, hosted Auth/RLS change or production application test is authorized/performed by this stage. The previous release execution record remains separate and is not included in this stage's checkpoint.

## What was incomplete

1. Fair Queue selection was global and defaulted to legacy. There was no persisted distinction between existing sessions and newly created events, so changing a flag could affect every event's next operation.
2. Root application/RootLayout failures and global unknown routes had no product recovery UI. Public event errors offered navigation but no real server retry. Admin boundaries used `reset`, which Next16.3 documents as clearing an error without refetching Server Component data; recovery should use `retry`.
3. A401 queue operation remained a retained conflict but had no same-account resume path. Its HTTP status was not preserved when reloading the IndexedDB entry. Version-one entries without that field now recover the exact old canonical401 reason as a **manual** authorization conflict, retaining their original operation/actor/CAS; they are never automatically replayed.
4. Search failures relied on re-entering/submitting the query. There was no visible retry button; retrying pagination could leave the preceding error message visible.429 had the same search message as other errors.
5. Offline entry pages lacked an application-wide connection notice. Existing detailed Realtime/outbox/session states needed to be retained rather than replaced with a single generic outage page.

## Fair Queue v2

New local migration0036 adds a constrained per-event engine. The expand/backfill/default/constrain sequence pins **every pre-existing event, including drafts, to legacy**. New inserts default to `rotation-v2`. Queue rows and order, `now`, performance history, participant identities and API identifiers are not migrated or rewritten. No automatic Fair Sort is run.

Fair Insert and Fair Sort read the same persisted choice. Audits and preview hashes record the effective engine. Global `KUNESTU_FAIR_QUEUE_ENGINE=legacy` remains the emergency fallback, while a global v2 setting cannot silently override an old event's legacy choice. Unknown environment values fail closed. The new-event creation paths inherit the database default; no browser-supplied engine is trusted.

The mathematical v2 implementation is unchanged. Existing tests retain newcomer/first-turn protection, immutable confirmed history after restore, exclusion of cancelled starts, anti-starvation admission budgets, current-now handling, stable tie-breaking, legacy identities and preservation of manual pairs. The new migration test creates an existing live event and approved/done requests before0036, then checks its retained legacy choice, the new-event v2 default, identical queue/history digest and rejection of invalid engine values. The service integration checks v2→legacy→v2 fallback without changing live order and refusal of a stale cross-engine Fair Sort preview.

Configuration facts: the current task process has no engine override; this worktree has no dotenv files. The isolated launcher supplies and validates loopback-only credentials in memory and strips ambient cloud credentials. A GET-only Vercel project-environment inspection at10:38:27 UTC found no Production Fair Queue override and the existing `SONG_SEARCH_ENGINE=unicode-v2`. No setting was changed. This does not activate new code on the old serving deployment.

See [release/fallback runbook](../runbooks/product-completion-release.md) for schema-before-code ordering, configuration validation and non-destructive rollback. Production0036 remains pending separate authorization. Changing a Vercel environment variable is not an instantaneous in-process flag switch.

## Recovery architecture and inventory

The shared view uses the existing dark/pink design tokens, fluid type, responsive controls and a small independent PL/EN/UK catalog. A tiny independent catalog is deliberate: global RootLayout errors must work without a healthy intl provider, loaded main catalogs, database or Auth. Normal screens preserve their resolved locale; global fallback uses the saved locale cookie first, then browser preference, then the appropriate fallback. No Auth/participant token is read from browser storage.

| Surface / state | Actual mechanism and recovery |
|---|---|
| Unexpected page/segment render exception | `src/app/error.tsx`, shared safe view and Next16.3 `retry()`; no exception text/stack rendered |
| Root layout/template exception | `src/app/global-error.tsx`, independent html/body/styles/catalog, manual retry and language selection |
| Unknown global URL /404 | `src/app/not-found.tsx`, localized explanation and working event-code entry link; no meaningless retry |
| Dashboard render exception | Dashboard segment boundary; same real server retry |
| Dashboard dependency503 | Existing server catch returns the shared unavailable view; explicit router refresh instead of an inert message |
| Public event render exception | Existing segment boundary now uses real retry |
| Admin page and admin-layout exception | Existing boundaries now pass `retry` into the shared recovery state |
|401 / expired operator session | Existing verified sign-in redirect/API401 preserved; queue-specific same-account sign-in/resume keeps the persisted operation ID, actor, CAS and payload |
|403 / insufficient platform rights | Actual access-denied view uses the shared safe forbidden state; server RBAC and hidden protected contents remain unchanged |
|429 | Existing join/session lifecycle messages retained; search explicitly tells the user to wait, then offers a manual retry |
|500 /502 /503 API or network failure | Existing safe API JSON mapping remains separate; search error/retry and unavailable render recovery; no raw response/driver message rendered |
| Offline | Application notice based on browser online/offline events; preserves mounted forms and outbox. Recovery screen distinguishes a disconnected retry from an authorization/404 decision |
| Realtime lost / reconnect / background resume | Existing connection health/reconnect components, bounded retries, snapshot verification and canonical ACK semantics retained; no interval queue polling or false synchronized state added |
| Search first page / pagination error | Explicit retry uses the same query or retained cursor, preserves results as appropriate, clears obsolete pagination error and does not automatically repeat mutations |
| Invalid/revoked code or session capability | Existing join-code gate and invalid session lifecycle; requests a current organizer code, never redirects a revoked link to a replacement |
| Scheduled /closed /cancelled /disabled session | Existing localized lifecycle/capability states retained; appropriate code entry or bounded scheduled refresh, no reopening of an event |
| Participant nickname, duplicate,2/2, linking/merge failure | Existing safe code/parameter mappings, inline/dialog feedback and identity invariants retained |
| Queue conflict / ambiguous write / local storage failure | Existing retained intents, explicit conflict decisions and receipt reconciliation preserved;401 gains a separately guarded resume path,403/account switches cannot use it |

API status is not fabricated by an HTML error component. Expected API errors still return JSON and existing status codes. Existing Auth redirects remain authoritative; no experimental `authInterrupts` setting is enabled. An upstream provider/CDN outage page when Next cannot execute cannot be customized by these boundaries; local tests cover equivalent502/503 API/network responses, not control of Vercel's own outage UI.

Accessibility checks cover semantic heading/landmarks, accessible controls, keyboard/programmatic heading focus, status/alert announcements, visible focus for controls,44px targets,200% text sizing and mobile/tablet widths. A browser screenshot review is not full WCAG certification. Physical tablet, NVDA/VoiceOver, Windows forced-colors and long-event ergonomics remain manual checks.

## Safety and security closure

0035 remains committed and unchanged in ancestry. This stage does not grant browser table access, relocate pg_trgm, revoke required helpers, weaken validation, suppress console errors, rotate JWTs or alter hosted Auth. Local security tests check actual RLS denial and positive membership/public delivery; the event-trigger analogue verifies the distinction between EXECUTE exposure and a callable business RPC.

The runbook contains the complete decision/risk table with evidence, limits and follow-up triggers: required SECURITY DEFINER helpers, managed auto-RLS least privilege, backend-only RLS, extension placement, Auth controls, process-local/NAT rate limiting, private channels and public API scope. Distributed abuse protection and provider controls are not falsely marked fully verified. The prior hosted cache-drain gate remains unresolved and cannot be replaced by a local PASS.

## Verification and evidence

Final command outcomes and hashes belong in the accompanying stage evidence receipt. Earlier logs remain historical evidence; the receipt records actual dates and separate full/targeted runs. No synthetic test ran against hosted/shared databases.

The browser fault wrapper temporarily injects controlled RootLayout/segment exceptions only into the isolated test build, with a source backup outside the repository. It verifies exact source restoration and removal of its temporary route afterward. No fault hook or probe route belongs in the release commit. It runs the existing guarded Supabase/Auth/Realtime/PostgreSQL17 launcher and an optimized Next16.3 build.

Initial attempts found harness issues: a unit asserted an invalid empty Fair Insert as success (corrected to require its validation error); a migration fixture omitted mandatory workspace public_id; browser navigation raced a post-login redirect; an error selector matched Next's hidden route announcer as well as the intended search alert; an admin fixture used `admin` instead of the actual `platform_admin` enum value and then lacked an eligible platform owner. The final admin fixture bootstraps a minimal synthetic owner without creating extra catalog/events; that owner remains protected until the guarded launcher destroys its whole disposable database. These failures are retained in ignored local diagnostics and were corrected without disabling assertions, authorization, constraints or tests.

Functional verification is evidence for the stated scenarios, not proof that the application has no other defects. Final production GO still needs the separate authorization, current backup/preflight,0036, the outstanding Realtime containment gate and actual post-deployment smoke/observation. No new large module or Preview phase is proposed.

## Manual physical-device checklist

- On a real tablet, open the same event in PL/EN/UK; switch languages without changing identity or losing input.
- Check portrait/landscape, browser text enlargement, software keyboard, readable errors,44px targets, focus and screen-reader announcements.
- Turn Wi-Fi off/on during search and a queued operator action. Confirm the query/intent remains, no success appears before ACK, and reconnect recovers the canonical state without F5.
- Expire operator sign-in, use the separate same-account sign-in action, return and explicitly resume. Verify another account cannot replay the saved intent.
- With a second physical operator device, perform manual DnD, approve/start/done and a conflict; check local feedback, peer synchronization and explicit Fair Sort preview.
- Inspect invalid/closed session, access denial,404 and retry under a temporary error. Never force these failures on a real production queue.

These manual checks are **NOT RUN**, not PASS. Migration/runbook/provider operations remain separately authorized release work.

## Final results and verdict

All results below were produced on 2026-10-18 in the existing managed worktree, Windows, Node24.19.0, pnpm11.7.0, Next16.3.0 and local PostgreSQL17. Database/browser runners reject cloud dotenv files, strip ambient service credentials and verify their disposable loopback target before migration or synthetic writes. Browser checks use an optimized build, local Supabase Auth/Realtime and Chromium; mobile/touch/tablet checks are emulation, not physical-device certification.

| Verification | Actual result |
|---|---|
| `pnpm test` after the final outbox compatibility change | 430/430 Node and 750/750 Vitest PASS |
| `pnpm typecheck` | PASS |
| `pnpm lint` | Exit0, zero errors; three warnings in unchanged ignored `authorized-release-*` helper scripts from the previous release. No application-source lint warnings. Those unrelated files are preserved and excluded from this checkpoint. |
| `pnpm build` through the guarded build-only local launcher | PASS on restored, uninstrumented source; no recovery-fixture route in the final build |
| Owned PG17 engine migration, Collaboration and Identity integration | 24/24 PASS; includes unchanged existing order, new default, engine fallback, stale preview, transaction rollback, CAS and organization/actor/device boundaries |
| Owned PG17 Security Gate and official migration-window procedure | 2/2 PASS |
| Owned PG17 backend-only RLS / managed event-trigger analogue | 1/1 PASS |
| Full optimized browser run | 39 PASS, one admin-fixture initialization failure, one explicit natural-JWT-expiry skip. This command was **not** a complete PASS. |
| Corrected final-source browser rerun | 19/19 PASS: all six product recovery/default-engine cases plus thirteen Collaboration cases, including two operators, DnD, Fair Sort during a gesture, identity, offline/reconnect, lost ACK, stale snapshot and 20/50/100-row regression scenarios. Includes the formerly failing admin case and persisted version-one401 recovery. |
| `git diff --check` and checkpoint scope/security audit | PASS; full manifest and SHA-256 evidence in the adjacent receipt |

The full browser run is retained at `.artifacts/product-completion-browser-final.log`; the corrected targeted run at `.artifacts/product-completion-browser-outbox-final.log`. They overlap and must not be summed as independent coverage. The default one-hour JWT lifetime was not artificially shortened: the explicit opt-in natural-expiry drill remains NOT RUN.401 response/reload/same-actor recovery and403/actor-switch refusal were tested. Build-only verification provisions its own fresh PG17, applies the official migration chain and calls the actual `pnpm build`; it does not read production credentials or modify environment files.

| Area | Verdict and boundary |
|---|---|
| Fair Queue v2 for new events | **PASS locally; ready after0036.** Existing events retain legacy; emergency fallback is verified without rewriting data or running a sort. Not activated on production by this stage. |
| Recovery UX PL/EN/UK | **PASS for the inventoried application scenarios.** Real retry/navigation, root/segment404, safe API errors, offline, admin denial and outbox recovery work in the tested browsers. Provider outage pages, physical assistive technology and all possible faults are not certified. |
| Security closure | **Local regression PASS; residual risks explicitly classified.**0035 is preserved; hosted old-authorization containment is still an operational release gate. Distributed quotas, provider Auth controls and extension/managed-function review remain the documented risk decisions. |
| Local product checkpoint | **PASS within the stated verification scope.** No production DB/Auth mutation, deployment, push or domain/configuration change. |
| Return to release GO gate | **YES**, with this completed local product stage and explicit residuals. Immediate production release remains **NO-GO** until separately authorized0036/cutover, current backup/preflight, the prior Realtime containment gate, risk acceptance and post-release verification. This report grants none of those authorizations. |

The checkpoint contains only this stage. All36 earlier migration files, earlier checkpoints, the original private configuration and encrypted backup cores were checked and preserved. The unrelated untracked previous-release execution report is deliberately excluded. The exact changed-file list, file hashes, log hashes, preservation checks and excluded scope are recorded in [final-product-completion-evidence.json](final-product-completion-evidence.json). The commit SHA is reported after the local commit; it is not embedded recursively into its own committed evidence.
