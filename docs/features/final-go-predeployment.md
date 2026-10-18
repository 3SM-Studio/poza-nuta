# Kunestu â€” final GO unblock and pre-deployment preparation

Date: 2026-10-18 Europe/Warsaw (raw evidence uses UTC, including October17).
Continuation of [Security Gate](enterprise-production-release-security-gate.md).
This report supplements historical results; it does not assign them a new run date.

**GO — READY FOR AUTHORIZED RELEASE.** The technical preparation gates below have
passed. Execution still requires the owner's separate approval, including brief
Realtime suspension/resumption. If that containment step is not approved and no
historical JWT-lifetime bound can be proven, STOP rather than deploy with cached
unauthorized sockets.

**Execution boundary:** local checkpoint, hosted read-only inspection/backup and
isolated restores/tests only. No push, hosted migration, hosted Auth/RLS/config
change, deployment, domain/DNS/alias change or production event interaction.

## Checkpoint and preserved state

Created the explicitly approved local commit:

- SHA `293193db1421324cbab3f837eac85c941d33d90f`.
- Parent `372a9b9869a0f9df905142862352968c66160ef1`.
- Branch `michal-szwindowski/kunestu-search-reliability`.
- Exactly13 files from `enterprise-release-gate-files.json`:0035 SQL/snapshot/journal,
  Security Gate docs/evidence/manifest, Playwright inclusion, scope/migration tests,
  Collaboration fixture and isolated Vitest config. Earlier checkpoints remain ancestors.
- Verified12 content hashes,17 local evidence hashes, full staged diff and exact
  allowlist. No high-confidence secret findings. Staged check found CRLF in two
  new JSON documents; normalized only those toLF, recalculated manifest and passed
  cached check before committing. No old migration bytes changed.
- Original checkout's private `.codex/config.toml` and unrelated readiness document
  remain byte-identical. All40 files in the previous October16 backup remain intact.

Additional preparation after that checkpoint remains **uncommitted**: this report,
its evidence receipt, runbook update, expiry/suspension E2E and its config inclusion.
No application runtime code, Fair Queue math, permissions model or package version
was changed. The original13-file manifest describes the committed gate snapshot;
new runbook edits are a separate, visible working-tree delta.

## Security Gate and Realtime containment

0035 replaces the globally-active-operator check with existing eventâ†’organization
membership authorization. Preserved real-browser proof shows Aâ†’B private queue
denied after a fresh join; own queue/participants and public capability queue work;
anonymous dashboard joins and client-forged broadcast writes fail; B's business
API returns404 toA. PostgreSQL negative tests cover inactive/suspended membership,
organization/operator, roles, malformed topics and grant/RLS boundaries.

Reviewed all three application topic families again: dashboard queue, dashboard
participants and capability-scoped public session queue. Participants already uses
the scoped helper. Public capability access is intentional and the server sends
its invalidations privately. No additional same-class policy defect was found in
these routes. This is not a claim about unimplemented future channel families.

Policy DDL does not evict cached socket authorization. The new guarded real-browser
drills in `realtime-authorization-expiry.local.spec.ts` cover actual server-side
expiry and forced tenant suspension, followed by fresh denial and positive own/
public delivery. Tokens are held in memory; no production credentials are loaded.

**Preferred production procedure:** after0035 and fresh policy verification, with
separate owner approval, temporarily PATCH Realtime `suspend=true`, verify actual
old-channel disconnect and blocked fresh joins, then restore `suspend=false` and
verify Aâ†’B denial plus own/public delivery. Exact API, local executable test,
deadlines and recovery are in the [release runbook](../runbooks/enterprise-production-release.md).
This has not been executed against hosted Supabase. Local implementation behavior
and hosted Management API transport/permissions are explicitly different evidence.

The alternative waiting procedure has a measured hosted `jwt_exp=3600`; the local
120-second drill demonstrates expiry without a cooperative client. Waiting alone
also requires a proven bound for previously issued/custom tokens. Current config
does not establish historical token lifetimes. Controlled suspension avoids that
uncertainty; no signing key rotation or database-service restart is proposed.

Latest forced-drain proof used the ordinary3600s JWT and did not renew A's token:
old authorization terminated561ms after policy commit (includes test emission and
RPC overhead), fresh A→B join denied,0 post-drain signals toA, own/private and public
delivery restored. The120s expiry run detected server expiry724ms after the JWT's
deadline. Both are local measurements, not hosted latency guarantees. The forced
drill also passed separately with a120s still-valid token.

## Fresh production preflight â€” read-only

Target independently checked from owner designation, exact session-pooler scoped
username, matching public Auth host, verified TLS certificate and Management API
project ID. Sole target `qwmimnhdnzqfckswxjww`, ACTIVE_HEALTHY, DBregioneu-central-1.
Administrative source connections use session pooler5432, max1, preparefalse and
`default_transaction_read_only=on`; the snapshot transaction is READ ONLY.

| Observation | Actual result |
|---|---|
| PostgreSQL |17.6 (`170006`) |
| Drizzle |32 entries through0031; every hash/timestamp matches;0032â€“0035 pending |
| Database size |204,573,843 bytes (195.10MiB) |
| Actual data disk |2,077,073,408 bytes; available1,546,387,456 bytes (1.44GiB), from provider metrics/API |
| WAL directory |134,218,131 bytes at sample; no replication slots in later sample |
| Connection ceiling |60;3 superuser-reserved;0 other reserved |
| Later connection sample |9 DB backends,7 client backends,0 other active queries; at least48 ordinary slots even conservatively subtracting all9 backends |
| Transactions/locks |0 older than60s,0 blocked; earlier public relation locks all granted AccessShare |
| Effective active karaoke |0 at read; expired `status=active` rows alone were not treated as live events |
| Maintenance work memory |32MB; max_wal_size1GB (soft checkpoint target, not free-space guarantee) |
| Plan |Free, confirmed by organization API; backup schedule/retention/PITR entitlements disabled |
| Realtime limits |200 clients,100 events/s,100 joins/s,20 presence events/s,100 channels/client; authorization pool2 |
| Storage / Edge / Vault |0 buckets,0 objects,0 Edge Functions,0 Vault secrets |
| Public business tables |24 RLS-protected; no browser role DML exposure |
| Auth |Signup disabled; email confirmation retained; canonical callback allowlisted; SiteURL origin matches existing canonical domain |
| Vercel |Existing projectpozanuta, Node24, READY Production `dpl_2HM5HjWHffVM7zH76BUMngXbx85V`, SHA703c145, function regioniad1 |
| Logs |No error/fatal groups returned in available30-minute Vercel window;1h query rejected by retention boundary and corrected |

Provider database SSL-enforcement flag isfalse. The performed native connection
nevertheless verifies TLS to the pooler using the providerCA. Backend `pg_stat_ssl`
reportsfalse for the poolerâ†’DB leg; this is not proof of end-to-endTLS and is not
silently relabeled as such. No SSL setting was changed. Realtime health is reported
healthy; an idle tenant may have no DB replication connection. Current live WS
count, peak-hour CPU/IOPS, monthly usage/fair-use averages and complete historical
Postgres error logs were not established. Obtain them read-only from Supabase
Realtime Reports/Infrastructure/organizationUsage and Logs Explorer before an event
capacity decision. They are not inferred from the connection ceiling or one quiet
sample. No production load generator was run.

Free database quota is500MB per current official guidance, distinct from physical
disk capacity. Chosen pre-DDL reserve: available disk above
`max(512MiB,4Ă—index+2Ă—indexWAL+128MiB)` and DBsize+index+64MiB below500,000,000 bytes.
Current samples pass both. This bounded-release budget must be refreshed before
DDL; it does not certify unbounded future imports or continuous peak traffic.

## New encrypted backup and actual restore

New folder, never overwriting the October16 backup:

`C:\Users\michas\.codex\backups\kunestu-prod-20261018-predeploy-kRnpxO`

Snapshot UTC2026-10-17T23:33:13.542Z. PG17 custom-format dump and table inventory
share one exported REPEATABLE READ READ ONLY snapshot; its exporter remains open
until dump completes. Roles captured separately with no role passwords. No plaintext
dump is written to disk. AES-256-GCM, independent nonces, authenticated tags and
cipher/plaintext SHA256; random key wrapped by Windows DPAPI CurrentUser. Directory
ACL permits current user andSYSTEM. All6 core encrypted artifacts authenticated
and verified again after completion.

Includes full database schemas/data (application, Auth, Storage metadata, private
functions, RLS/grants, Realtime, Drizzle history), roles/memberships, provider PG
settings, encrypted recovery credentials and encrypted Management API Auth/Realtime/
effective Storage configuration. Storage snapshot has no objects/buckets, so there
are no file bytes to export; it is not represented as a file backup. Vault empty,
Edge Functions empty, MFA factor table empty. Auth users/identities/session data
are included in the database dump.

Final standalone recovery helper was actually executed from the private backup
folder, creating a new Supabase PostgreSQL17.6 clone, `--network none`, no published
ports, tmpfs data, no host source-data bind or production connection. Verified:

- 73 table counts and stable row digests,0 differences;
- 275 constraints;5 CHECKs server-canonicalized in rolled-back transactions;
- 33 role attributes and25 memberships;
- 98 relation ownership/RLS/ACL records,268 indexes,10 policies and22 sequences;
- 32 migration entries,92,014 source songs,92,014 projections and2 Auth users;
- 9 provider PostgreSQL settings replayed solely on the isolated clone.

Earlier attempts were stopped at comparison differences, not passed silently:
ACL entry order/default-owner representation, two extension-created view owners/
ACLs, and bigint JSON number representation. The helper now replays captured owners/
grants exactly for those two views, compares order-independent ACLs with equivalent
owner defaults and exact grantors/options, and compares sequence bigints as text.
The successful final attempt used a fresh clone, not the earlier modified attempt.
Diagnostics remain encrypted; successful verification supersedes failed-attempt
status, whose files remain for evidence.

Dump creation completed23:33:43UTC. The standalone successful restore ran from
23:46:28 to23:47:12UTC (~44s); earlier inspection/fix attempts account for the
longer overall preparation time. All three owned rehearsal clones were removed
after verification; encrypted backup/helper/results remain. Older containers and
backups were not touched.

Recovery is reproducible with `node recovery/restore.mjs` from the backup folder.
`RECOVERY.md` explains scope and STOP conditions. This proves same-project DB
recovery while retaining hosted provider signing/encryption roots. It does not
certify reconstruction of an entirely new hosted Supabase project. DPAPI recovery
requires this Windows account/machine; independent off-machine key escrow was not
performed. Managed passwords/signing roots must be retained/reset through the
provider's authorized recovery process. Never load recovery credentials into tests.

## Restored real-catalog index measurement

After a verified restore, applied only the exact0034 index SQL on the isolated
clone (no source writes or hosted journal marking).92,014 actual catalog records:

| Metric | Measured |
|---|---:|
| CREATE INDEX execution |2142.724ms |
| Whole Docker/psql call |2390.000ms |
| New GiST index |20,709,376 bytes (19.75MiB) |
| Generated WAL delta |17,366,536 bytes (16.56MiB) |
| Final index |valid/ready; source/projection counts unchanged |

This improves on the earlier synthetic size estimate; no titles/rows were exported
to logs. Local Docker resources/cache differ from hosted Nano compute. It is not a
production duration/peak-memory guarantee. The separately preserved official
Drizzle concurrency rehearsal remains the proof for the two-batch procedure:
0032â€“0033 then0034â€“0035, no migration-engine rewrite.

## Tests, authorization and final decision

Fresh `pnpm test`:430Node and721Vitest PASS. Additional current typecheck, lint,
optimized build and the two targeted browser-drain results are recorded in the
accompanying evidence receipt. The earlier current-runtime gate retained33 browser
tests,2 new PG17 and22 Collaboration/Presentation PG17 tests through0035; their dates
and original logs remain unchanged. No production E2E, physical-device test or
production rollback drill was performed.

Final sequential `pnpm test`, `pnpm typecheck`, `pnpm lint` (0warnings/errors),
`git diff --check` and cached check PASS. Latest guarded launcher ran `pnpm build`
successfully for the final source before the ordinary-JWT suspension drill, which
passed in8.5s (11.2s Playwright total). Earlier combined expiry+suspension run passed
2/2 in2.3min; subsequent test-only clarifications preserved the120s expiry branch
and strengthened forced rejoin using the unchanged token. First expiry attempt
failed because its oracle watched CHANNEL_ERROR rather than the actual SYSTEM
expiry event; this was corrected, with no application error suppression. Lint
attempts overlapping generated test builds scanned temporary `.next-p3-e2e` output;
the final run occurred after launcher cleanup and passed without new ignore rules.

Follow the ten ordered PASS/STOP gates at the top of the runbook. Keep old app
running until both schema batches are verified; quiesce old/unversioned writers.
Keep expanded schema/receipts/history/index/policy on application rollback. Hobby
Instant Rollback supports the immediately previous Production deployment; save and
recheck703c145's deployment immediately before this single release. It restores
the application build/environment, not the database. Do not manually alter domains.

Still requires separate owner authorization: actual release SHA/integration/push,
production0032â€“0035 batches, synthetic online test fixtures, the brief Realtime
suspend/resume and Production deployment/possible application rollback. No regional
move, JWT rotation, event closure or destructive DB rollback is included. Technical
preparation does not grant execution permission.

Final technical decision and SHA256 evidence are recorded in
`final-go-predeployment-evidence.json`. The historical gate's NO-GO is preserved;
this fresh preparation supersedes its resolved blockers. Physical-device
ergonomics, peak-event soak and regional latency remain explicit release risks,
not falsely labeled fresh PASS results.

Tools: native Git/Node/PowerShell, PostgreSQL17 utilities/Docker, Supabase CLI and
GET-only Management/Metrics/Auth settings, Vercel connector read-only metadata/logs,
Context7 and official documentation. Generic Supabase MCP was not used because the
required scoped MCP was unavailable. Browser inventory was unavailable in Work
settings; the real browser drills used the existing guarded Playwright runner.

Primary references: [Supabase backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore),
[Realtime authorization](https://supabase.com/docs/guides/realtime/authorization),
[Realtime settings](https://supabase.com/docs/guides/realtime/settings),
[database/disk quotas](https://supabase.com/docs/guides/platform/database-size),
[Management API Realtime config](https://supabase.com/docs/reference/api/v1-update-realtime-config),
[Vercel Instant Rollback](https://vercel.com/docs/instant-rollback).
