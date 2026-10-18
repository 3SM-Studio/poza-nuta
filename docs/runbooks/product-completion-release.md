# Product completion: event-pinned Fair Queue and recovery UI

This stage authorizes local implementation, isolated tests and one local checkpoint only. It does not authorize push, deployment, hosted0036, changes to Auth, RLS, domains, aliases or Vercel configuration. Existing release remains paused; see the separate execution record. Existing encrypted backups and their restore receipts are preserved.

## Algorithm configuration

`events.fair_queue_engine` stores `legacy` or `rotation-v2`. Migration0036 expands nullable, backfills every existing event to `legacy`, sets the default for future inserts to `rotation-v2`, and constrains the column. It does not write song requests, performance history, queue positions, participant identity or any Fair Sort action. Existing drafts are deliberately treated as existing events too. Moving one to v2 later requires an explicit event-specific decision and a quiet queue; this stage adds no automatic opt-in for old events.

The runtime uses the stored event choice for both Fair Insert and Fair Sort. The environment variable `KUNESTU_FAIR_QUEUE_ENGINE=legacy` is the emergency override for all events. `rotation-v2` does not override a persisted `legacy` choice. An absent variable uses the event choice. Unknown values fail closed. Compatibility calls without a persisted choice use the explicitly configured global engine, or legacy when no override exists; real event records must satisfy0036's NOT NULL/check constraints.

Fair Sort preview revisions include the effective engine. A preview made under v2 cannot be applied after an emergency switch to legacy. Manual placement remains explicit and atomic, and Fair Insert preserves the existing pair order. Neither migration nor an engine switch initiates Fair Sort.

## Future authorized release gates

1. Obtain separate release authorization and resolve the prior Realtime cache-drain verification gate. Never reopen the vulnerable pre0035 policy to recreate a canary.
2. Reconfirm the serving deployment, correct project, quiet window, migration history and fresh backup/restore. The previous verified backup was taken before0032–0035; retain it, but do not silently treat it as a fresh snapshot of the now-expanded schema and later data.
3. Review the exact release SHA and0036 content. Verify hosted journal through0035; do not replay or manually mark old migrations. Existing two-batch0032–0033 /0034–0035 procedure remains historical evidence, not permission to run them again.
4. In a short, separately authorized official Drizzle transaction apply only pending0036. Retain bounded lock/statement timeouts and stop on any error or uncertain commit. It briefly locks events, so this requires a quiet window even though it does not reorder queues.
5. Verify every pre-existing event ID is legacy; no NULL/unknown engine exists; column default is rotation-v2; the check constraint is valid; request/history counts and digests match; RLS/grants are unchanged. Keep event creation and queue writers quiescent through schema/code cutover: an old application does not read the new column. If an event becomes active or an old writer creates one between migration and new-code verification, STOP and inspect that exact scope; do not silently retag, sort or close it. Do not create a real event solely to test the default without approved synthetic scope.
6. Verify project environment override. A `legacy` override intentionally suppresses new-event v2. The GET-only read at2026-10-18T10:38:27Z found no Production Fair Queue override and `SONG_SEARCH_ENGINE=unicode-v2`. Project configuration is not proof of the environment captured by any different deployment; inspect the actual release before claiming activation. No environment setting was changed here.
7. Deploy the reviewed code to the existing `pozanuta` Production only after approval, with the unchanged canonical URL `https://pozanuta.vercel.app`. No Preview, domain/alias operations, region move or plan change. New code requires0036; old code can ignore the additive column.
8. In an approved private synthetic event verify the preview reports v2, Fair Insert, manual placement, explicit Fair Sort, 2/2, immutable performance history, identity and two-operator reconciliation. Existing live events must retain their configured engine and order. Verify public PL/EN/UK recovery, API failures and reconnect without writing to actual queues.

## Emergency fallback

Use the **same reviewed application code** with `KUNESTU_FAIR_QUEUE_ENGINE=legacy` via a separately authorized environment/deployment change. Vercel environment changes are not an in-process hot switch: allow the replacement functions to become active, drain mixed writers, and verify the actual effective engine. Do not promise a zero-time cloud switch.

The fallback requires no data mutation. Keep the stored event choices, all receipts, audit entries, history, participants, indexes and policies. Discard an old Fair Sort preview and obtain a new one. Do not run Fair Sort automatically, delete pending operations or clear IndexedDB. Removing the override later resumes each stored choice, including legacy for older events.

Application artifact rollback remains the separately documented recovery path. Preserve the additive schema and0035 policy. Never issue a down migration or a blanket GRANT as rollback. Before reverting to an older client contract, resolve/retain unconfirmed operations and drain/refresh operators; an HTTP error alone does not establish whether a write committed.

## Security decisions

| Item | Classification and decision | Follow-up trigger |
|---|---|---|
| Cross-organization private queue subscriptions | Confirmed vulnerability;0035 is in release ancestry, installed on the previous authorized release attempt, and tested locally with real Auth/WebSockets and RLS. New joins must be scoped by event membership. | Cached pre-fix authorizations still require the separate release containment gate before GO. Do not claim hosted drain PASS from local proof. |
| Business RLS / public APIs | Preserve backend-only tables and no anon/authenticated business DML. API guards remain authoritative. No new grants/policies in0036. | Every future table, grant or membership change requires negative A/B tests. |
| SECURITY DEFINER membership/broadcast functions | Required scoped helpers with fixed search paths and restricted execute; preserve them. | Review any new function, dynamic SQL or privilege expansion before release. |
| Managed auto-RLS event-trigger EXECUTE warning | Least-privilege warning, not demonstrated arbitrary RPC: PG rejects direct invocation (`0A000`); isolated revoke analogue returns `42501` and keeps auto-RLS working. No blind hosted revoke. | Owner-approved dependency review within30days, or before any exposed RPC/schema change, whichever comes first. |
| pg_trgm in public | Extension placement warning; public CREATE is restricted in preserved evidence. Moving it can break operators, indexes and runtime search paths. No confirmed exploit here. | Dependency/extension maintenance review within30days or before changing schema CREATE rights. |
| Supabase Auth | No Auth changes. Existing local business membership remains required beyond identity. Prior evidence records Free plan, signup disabled, callback origin and JWT lifetime. Breach-password protection and provider maintenance are not freshly certified by this local stage. | Owner review before wider operator onboarding; do not claim an application password rule replaces breach detection or upgrade a plan implicitly. |
| Rate limiting | Atomic process-local device/NAT counters plus DB search admission; tests cover parallel requests and shared IPs. These are not a distributed global quota. | Explicit residual-abuse-risk acceptance for this release; inspect/approve NAT-aware WAF/shared enforcement before a large public launch or after rate/connection alerts. No WAF/config change in this stage. |
| CSP / browser compatibility | Existing worker fallback and no secret exposure preserved; no new permissive CSP workaround. | Compatible CSP rollout and physical-device/assistive-technology checks remain separate checks, not a reason to suppress errors. |

These are scoped decisions, not a claim that no undiscovered vulnerability exists. Unverified provider controls remain unverified. Any actual authorization/data-integrity failure is a release STOP.

## Error recovery safety

Normal render failures use Next16.3 `error.tsx` and `retry()`. Root-layout failures use `global-error.tsx` with their own document/styles and a tiny PL/EN/UK catalog that does not require a working intl provider, database or Auth. Expected session lifecycle errors, component network failures and API JSON responses remain separate mechanisms. Existing 401 sign-in redirects and server RBAC remain in force; no experimental `authInterrupts` routing feature is enabled to manufacture HTTP status pages.

No automatic retry of arbitrary mutations is added. Search retry is explicit and retains its query/cursor; its new button uses the actual search operation. Outbox401 recovery retains the exact operation ID, actor, CAS and persisted payload, opens sign-in separately, and checks the same actor before retry. A403 or account switch cannot use that path. Existing bounded uncertain-write retries and receipt reconciliation remain in place.

Crash/reload recovery assumes working browser persistence. Existing storage/quota failures remain visible and block the corresponding POST; do not describe memory-only work as durable or promise recovery after a simultaneous browser/storage failure. Never clear the outbox to make an error disappear.

Upstream Vercel/CDN502/503 pages when the application cannot execute are outside an App Router boundary. The application handles their API/network equivalents locally and safely; this stage does not pretend to customize provider outage pages. No console-error override or stack-trace rendering is introduced.
