# Kunestu: approved-release procedure and rollback

Prepared 2026-10-18. **Not executed; not authorization.** Current decision and
evidence: [security gate](../features/enterprise-production-release-security-gate.md).
No Preview. Existing project `pozanuta`, canonical URL
`https://pozanuta.vercel.app`, sole database `qwmimnhdnzqfckswxjww`.
No DNS/domain/alias/project operation is part of this procedure. Standard Production
deployment/rollback updates the application behind the existing domain only.

## A. Approval and preflight

1. Obtain approval for exact release SHA/file manifest, new encrypted backup and
   restore, migration batches, Realtime connection containment, test event, and
   Production deployment. Regional change to fra1 requires its own explicit scope.
   Fair Queue rotation-v2 is **not** implicitly included in approval.
2. Read serving deployment/alias afresh and save the exact rollback ID/configuration.
   Expected current rollback: `dpl_2HM5HjWHffVM7zH76BUMngXbx85V` / `703c145`.
   Confirm it is still READY/available; do not infer rollback availability from Git.
   Verify plan entitlement and permission to use Instant Rollback. No drill has been
   performed in production. If no available recovery artifact, STOP.
3. Confirm runtime DATABASE_URL mode (transaction pooler 6543, prepared statements
   off) and public Supabase ref in private configuration; do not print values.
   For administrative reads/migration use verified session/direct connection with
   validated TLS and matching scoped ref. Retain provider secrets outside repository.
   Distinguish TLS to pooler from pooler→database transport; inspect enforcement.
4. Compare every existing Drizzle hash/timestamp to the approved files. Expected
   source: 32 entries through 0031. Reinspect pending objects, helper definitions,
   trigger ownership, RLS and pg_trgm class resolution. No manual journal marking.
   STOP on drift, unknown migration or concurrent deployment/migration.
5. Verify free database/storage quota, temporary index/WAL headroom and resource
   limits using the provider's actual current usage/quota view. A 195 MiB used
   database and a local 13–19 MiB index do **not** establish headroom. Use the fresh
   restore's measured build size and a conservative transient-space reserve,
   including queued WAL. Document the selected threshold before proceeding.
6. Choose a quiet owner-approved window. Check effective event lifecycle
   (`closed_at`, status, starts_at, coalesce(auto_close_at,ends_at)) and active
   operators/pending writes; do not close a real event merely to make a gate pass.
   Ask operators to finish acknowledged writes and stop interacting. Pause import
   workers via their approved mechanism and drain existing jobs/transactions.
   If writes cannot be quiesced, defer the migration. A UI maintenance message by
   itself does not fence all public API writes.
7. Decide how to expire cached Realtime authorization after 0035. Verify maximum
   JWT lifetime and provider support for an approved service/client disconnect.
   Either disconnect all old relevant sockets through a verified provider procedure
   and verify fresh joins, or wait the proven maximum remaining JWT lifetime after
   policy commit. Policy DDL, a browser reload request and an application rollback
   alone do not force a malicious existing socket to reauthorize. If the window
   cannot contain these connections, STOP; do not claim tenant isolation fixed.

## B. New backup and isolated restore — hard gate before DDL

Existing encrypted backup is historical and immutable. Create a new uniquely named
folder outside all repositories with current-user/SYSTEM ACL and fresh random key.
Do not point the older recovery scripts at their old output paths: they write private
diagnostics/manifests there. Adapt reviewed copies to the new folder, inspect them,
and keep the old folder and key untouched.

1. Use PostgreSQL 17 native utilities or the official Supabase backup procedure.
   The previously proven application-specific method is PG17 custom-format dump
   with all required schemas and a single exported REPEATABLE READ READ ONLY
   snapshot. Keep its exporter transaction open until both dump and inventory finish.
   Privately verify target ref, TLS, version and read-only state before exporting.
2. Configure `PGSERVICE`/`PGPASSFILE` privately with restrictive ACL, or pass the
   credential to a controlled process in memory. Never put a password/connection
   URL in a command printed to logs, Git, a shell history, or public argv example.
   Equivalent dump intent: `pg_dump --format=custom --snapshot=<exported snapshot>
   --no-tablespaces --dbname=<private service>`; roles are captured with
   `pg_dumpall --roles-only --no-role-passwords`. These are **not** commands to run
   against an unverified target or with literal placeholder credentials.
3. Include application, Drizzle history, Auth, storage metadata, private functions,
   RLS/grants, Realtime and required vault schemas/roles. Record schema/version,
   per-table row counts and stable digests from the same snapshot, FK/CHECK/index
   definitions, owner/ACL and required role attributes. Keep inventories encrypted;
   emit only aggregate verification counts. Roles/provider configuration are separate
   capture scopes; quiesce administrative changes during their capture.
4. Freshly inventory Storage buckets/objects. If any objects exist, separately back
   up their actual bytes/metadata, version and checksum to encrypted storage; a SQL
   dump is not file backup. Capture any current Edge Function sources/configuration,
   provider Auth redirects/SMTP/OAuth/signing-key continuity and required encryption
   roots privately. Record unavailable pieces as STOP when recovery depends on them.
   Do not fetch irrelevant personal data or export Vault plaintext into logs.
5. Stream plaintext only in memory/pipes into AES-256-GCM encryption with a unique
   nonce per artifact. Protect the random key with DPAPI CurrentUser and document
   owner-controlled key continuity; arrange encrypted off-machine escrow separately
   if required. Store ciphertext/plaintext SHA256 plus authenticated tags. No host
   plaintext dump, trace or backup enters the release directory.
6. Authenticate-decrypt every artifact, compare hashes, and actually restore to a
   **new**, owned Supabase PG17 clone: network none, no published ports, tmpfs,
   no bind mount of source data and no production credentials/client. Use the
   provider-compatible PG17 image and reviewed roles/provider configuration from
   the prior verified procedure. Temporary superuser/provider settings are permitted
   only inside that clone, never on hosted production. Reapply original role flags.
7. Compare every required table count/digest, constraints, role attributes/ACL,
   sequences, journal and source/projection reads. Reparse equivalent CHECKs on the
   clone rather than ignoring discrepancies. Verify Auth data and, if used, actual
   Storage object reads. Same-project DB restore does not certify reconstruction
   of a brand-new hosted Supabase project.
8. Rehearse the selected migration batches on this fresh clone and compare protected
   source data after. Preserve signed/hash evidence, elapsed time and limitations.
   **Any unexplained mismatch or failed restore: STOP before production DDL.**

Budget planning, not a measurement: reserve 15–30 minutes for backup/restore and
clone checks, based on the previous ~8-minute simple restore plus safety margin.
Actual provider speed/data growth may exceed it. Record actuals; do not truncate
verification to meet a promised time. Do not restore the old October 16 dump over
current users as rollback.

## C. Freeze the exact integrated release

After local approval, create one reviewed local security/integration commit on top
of 372a9b9. Existing ancestor chain remains intact. Stage only allowlisted new paths;
inspect full staged diff and `git diff --cached --check`. This audit creates no
commit itself. Preserve private/unrelated files in the original checkout.

Use a clean release directory from the exact approved Git tree. Explicitly exclude
`.env*` except placeholder example, `.codex`, `.auth`, `.artifacts`, test-results,
backups, local setup/worker secrets and build caches. Never upload the active
development folder blindly: its .vercelignore is not a complete list of every
role-specific ignored environment file. Inspect an actual release file manifest.

Verify the linked existing Vercel project/team and current production branch mapping.
Do not push a branch that triggers auto-deploy before schema gates. Integrate by
fast-forward only if the destination is a verified ancestor; otherwise review a
merge locally and test any new conflict resolutions. No force push or secret env pull
into the development checkout. No new Vercel project, alias command or Preview.

## D. Two official Drizzle batches, in journal order

The normal CLI config intentionally rejects cloud URLs. Do not weaken
`assertLocalDatabaseTarget`, set `KUNESTU_LOCAL` deceptively, or use `drizzle-kit push`.
Use a separately reviewed release-only administrative runner, privately configured,
with the **installed official Drizzle postgres-js migrator**. Our isolated test
`tests/postgres/releaseMigrationWindow.integration.test.ts` is the executable model:
no custom replacement transaction engine or hash algorithm is needed.

1. Materialize a private, immutable migration-folder copy containing the approved
   `_journal.json` **prefix through idx 33**, and byte-identical SQL files for entries
   0–33. Assert tags, file SHA256 and entry timestamps against the release manifest.
   Do not edit the repository's journal or committed migration SQL. Drizzle reads
   the same folder format and computes the same migration hashes.
2. On one session/direct administrative connection (pool max 1, prepare false), set
   reviewed session lock/statement budgets (tested 2s / 30s), then call
   `migrate(drizzle({client}), {migrationsFolder: verifiedPrefixFolder})`.
   Administrative budgets are separate from application SQL timeouts. Do not
   increase them automatically after a timeout; stop and inspect blockers.
3. Verify 34 journal rows through 0033, exact hashes, new intent_version, receipt/
   stream tables, revoked browser grants, expected triggers/functions and unchanged
   source song/request/status/position data. If verification fails, STOP. Do not
   deploy new application code into a partially verified schema.
4. Commit boundary above releases the song_requests exclusive lock. With imports
   paused, call the same official migrator using the **complete approved folder**.
   It applies only remaining 0034 and 0035 in its own transaction. Verify 36 rows,
   exact hashes, valid/ready GiST index definition siglen=256 and scoped SELECT
   policy. Assert no new browser INSERT policy, no widened table grants.
5. Recheck counts/projection consistency, lock backlog and timeout errors. Never
   mark history applied manually, drop constraints or ignore a failed command.
   Release old Realtime authorization caches per the approved step A7 and prove
   own/new organization joins before declaring containment.

The fresh synthetic comparison shows why this split is selected: full pending
batch retains ACCESS EXCLUSIVE through the index; split batches remove that lock
from the expensive index phase. Exact final metrics are in the evidence JSON.
Queue DDL still requires a short exclusive lock, and catalog writes still block
during CREATE INDEX. This is reduced contention, **not a zero-downtime guarantee**.
No `CONCURRENTLY` variant is secretly substituted. If hosted lock/size budgets
cannot fit an approved quiet window, defer release and review a different migration
separately rather than altering this procedure in place.

Failure recovery: Drizzle rolls back all pending statements/history in the failed
invocation. If phase 2 fails, phase 1 stays applied; old code remains compatible.
The isolated negative test creates the index then deliberately errors, proves index
and phase-2 history absent, and retries the original files successfully. On real
failure check both catalog objects and journal before retrying. Do not run DOWN or
delete data. A lost client connection is an uncertain outcome: inspect history before
any retry. Failed 0035 leaves the security gate closed until verified containment.

Read-only postflight examples (run only on the independently verified target;
compare returned hashes with the approved manifest, not just these counts):

```sql
BEGIN READ ONLY;
SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id;
SELECT i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid),
       pg_relation_size(i.indexrelid)
FROM pg_index i
WHERE i.indexrelid='public.song_search_documents_fuzzy_distance_idx'::regclass;
SELECT policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='realtime' AND tablename='messages';
SELECT count(*) AS nonzero_initial_intent_versions
FROM public.song_requests WHERE intent_version<>0;
SELECT count(*) AS missing_documents
FROM public.songs s LEFT JOIN public.song_search_documents d ON d.song_id=s.id
WHERE d.song_id IS NULL;
COMMIT;
```

`nonzero_initial_intent_versions` is expected zero only at the quiet schema-only
checkpoint before new status writes. Do not reset legitimate versions to force
zero after activity resumes. Verify triggers, receipt ownership, browser grants,
bounded projection freshness and protected counts using the preflight inventory.
No singer or participant columns need to be printed. Keep line endings byte-stable
in migration copies: Drizzle hashes SQL bytes; do not reformat old files.

## E. Production deployment, existing URL

1. Keep `SONG_SEARCH_ENGINE=unicode-v2` as currently configured; no new projection
   backfill is required by 0034/0035. Before release verify missing/stale projection
   counts using the existing bounded Unicode validation. Any necessary repair uses
   the separately approved resumable runbook, never overwriting source songs.
2. Keep `KUNESTU_FAIR_QUEUE_ENGINE` absent/default legacy or explicitly legacy.
   Rotation-v2 requires a separate approved activation and fresh previews; never
   reuse a preview computed under another engine.
3. If approved, deploy Node functions in single region fra1 with one explicit region
   configuration source. No database move or domain change. If not approved, retain
   iad1 and document unmeasured WAN latency as a release risk.
4. From the verified clean release tree, use the existing project's authorized
   Production workflow (`vercel deploy --prod` or its existing Git integration).
   Verify CLI/project/team and the exact source SHA first. This is not a Preview or
   a new project. Do not run manual alias add/remove/set operations.
5. Wait for READY; independently read the canonical alias, SHA and emitted regions.
   Record previous/new deployment IDs, environment names/engine values without
   secret values. Confirm worker asset 200 and no accidental CSP relaxation.
6. Drain old function invocations and require operator tabs to refresh into the new
   versioned-operation contract. Existing old-form actions deliberately receive 409
   QUEUE_SYNC_REQUIRED on the new server, not an unconditional mutation. Retain any
   unsent local outbox intentions and review conflicts; never clear IndexedDB or
   tell the operator an unconfirmed action succeeded.

Allow 5–15 minutes for deploy/verification and 15–30 minutes for initial manual smoke.
These are planning estimates, not measured production SLA. Connection-cache draining
may require the verified JWT lifetime and dominate the window. A complete window
may be 45–90 minutes or longer; do not promise a short outage from local timings.

## F. Explicit manual smoke — not yet executed on this release

Use a dedicated owner-approved event/organization and synthetic accounts/participants.
Record only their IDs privately; never act on the user's current karaoke event.
Use a private/unlisted event where supported; do not change the single/default public
event setting or redirect existing QR codes. The current code supports multi-event
session routes under existing committed history; do not alter their domain semantics.

1. Sign in A and B as separate permitted operators. Verify own queue/participants
   subscriptions, API snapshot and healthy badge. Cross-organization dashboard and
   participants channels must deny fresh joins; business read/mutation APIs deny too.
   Unauthenticated clients cannot join dashboard topics or broadcast forged signals.
2. Public participant enters by existing QR/session route with PL, EN and UK browser
   preferences; switch language, reload, submit/cancel only own synthetic requests.
   Check original Unicode titles/artist search, typo recovery, page two, empty/error
   states and same-query retry after a controlled local—not production fault injection.
3. In the test event approve, move BEFORE/AFTER, cancel reject dialog, then confirm
   only a synthetic rejection. Check the peer's canonical queue and unchanged now.
   Test concurrent independent moves, explicit conflicting start, done, manual order
   then approval, preview/apply Fair Sort and stale preview rejection. Confirm 2/2.
4. Check Presence, rename/linking/merge only for synthetic participants with the
   usual confirmation. Other participants/real queues remain untouched.
5. On real phones/tablet: touch drag versus scroll, autoscroll, long cards, dialog
   cancel, language switch without lost form; keyboard Space/arrows/Escape and screen
   reader labels. Physical test results stay NOT EXECUTED until actually performed.
6. On two real Windows desktops/accounts: background for 20 minutes and later a
   multi-hour soak, Wi-Fi reconnect/sleep/wake, pending outbox and stale gesture.
   Return without F5; verify snapshot and ACK separately from socket live. Enable
   bounded safe in-memory diagnostics, never export JWTs/cookies/network payloads.

Observe fresh API timings and aggregate error counts. Suggested initial targets,
not measured WAN guarantees: healthy peer convergence p95 <2s/max <5s; no 57014/55P03
in the bounded test; no lost requests or silently overwritten conflicts; search
ordinary queries usable, heavy distinct burst only tested locally (p95 4.39s).
Do not run a production 20-client load generator. Category lists may converge within
60s per process; test an import only in its separately authorized job scope.

Observe for 30–60 minutes before broad owner use, and during the next event. Record
HTTP 429/503 rate, SQL cancellation versus lock timeout, admission exhaustion,
snapshot age, websocket reconnect count, Auth failures, pending/conflict outbox and
imports. No grouped 30-minute errors is not proof of long-term reliability.

## G. STOP and rollback

STOP before mutating anything if target, environment or current release differs;
backup/key/restore verification fails; journal/hash/object drift appears; free quota
is unknown/insufficient; an import/long transaction is running; quiet window cannot
be secured; cached unauthorized sockets cannot be contained; or scope/approval is
missing. STOP after a migration error/uncertain commit until state is re-read.

During smoke STOP expansion on any unauthorized cross-tenant join/read/write,
request loss, incorrect now/2/2, receipt duplication, unacknowledged-success UI,
persistent Realtime/snapshot failure, 57014/55P03 recurrence, widespread 429 at venue
NAT, Auth failure, wrong serving SHA/region/domain or unacceptable API latency.
Capture safe diagnostics and decide rollback; never suppress the error.

Application rollback:

1. Pause operators/test-event writes, preserve outbox/receipt IDs, record incident.
   Do not wipe local storage or restore an old database over new participant data.
2. Use the existing project's **standard Vercel rollback** to the recorded previous
   Production deployment. Expected ID above is provisional until the release's fresh
   preflight. This automatically restores serving application/config at the same
   domain; no manual alias/DNS action. Verify canonical URL, READY, SHA and region.
3. Keep migrations 0032–0035, all receipts, audits, identities, projections and index.
   Old application ignores additive structures; triggers continue minimal scoped
   invalidations. Keep the tighter 0035 policy even when the app rolls back.
4. Old clients/backends do not implement the new outbox protocol. Stop/refresh
   operator sessions, retain pending intentions for manual canonical review and a
   future safe new-client recovery. Do not replay them through legacy endpoints.
   Gate old/new overlap rather than promising automatic conflict semantics across
   a rollback. New code resumes only after schema and API contract checks pass.
5. If only search fails, `legacy` is an existing controlled fallback but loses
   non-Latin coverage and invalidates pending cursors. Merely editing a Vercel env
   variable does not alter the running immutable deployment: use a separately
   approved known-compatible legacy deployment or a new Production redeploy, then
   inspect the serving engine. The prior Unicode deployment is the default whole-app
   rollback; old historical fallback IDs are not presumed available without reads.
6. Vercel rollback can disable automatic production assignment. Check the current
   platform behavior/settings before the next deployment; use its standard approved
   promote flow if required. Do not repair assignment with manual domain commands.

Database incident recovery is a different, separately approved outage procedure:
preserve an incident snapshot, prefer forward-fix/index retention, assess post-backup
writes, and restore only to a verified target with explicit data-loss/RPO approval.
No destructive database rollback, table truncation or participant deletion is an
application rollback step. A stored encrypted backup with inaccessible key is not
a recovery plan. RTO remains unmeasured for hosted disaster restore.
