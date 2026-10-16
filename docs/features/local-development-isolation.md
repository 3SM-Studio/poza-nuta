# Local development isolation — 2026-10-16

> STOP by project owner on 2026-10-16: infrastructure work is suspended in favor
> of PL/EN i18n. Preserve all changes. At suspension: local E2E 13/13 PASS,
> PostgreSQL 54/54 PASS, Node 412 and Vitest 603 PASS, typecheck PASS. A later
> dotenv-fallback guard has one targeted test PASS. Final lint/build and the final
> isolation verdict were not completed; this document is an unfinished handoff.
> Do not resume environment, Vercel or MCP work without a new request.

## Scope and decision

Only local development and test safeguards were authorized. Production Supabase
`qwmimnhdnzqfckswxjww`, Vercel Production/Preview, MCP configuration and remote
secrets were not changed or queried in this implementation run. No commit, push,
deployment, production migration, production seed or production E2E was performed.

Checkpoint remains `721a1dd35caec0666d099024a344628c6e075c1c` on
`feat/kunestu-participant-model-fair-queue`. Existing Enterprise DnD, Fair Queue,
ThemeProvider, benchmarks and reports are preserved. Fair Queue mathematics and
DnD production implementation were not modified for isolation.

The former root `.env` and `.env.local` referenced production. Both were moved,
without rewriting their bytes, to the user-only ACL protected directory
`C:\Users\michas\.codex\private-backups\pozanuta-stage1-pre-isolation-20261016`.
Its private manifest records integrity hashes. This is a quarantine, not a source
of development credentials. Never restore those files to an active checkout.
`.codex/config.toml` is unchanged from the beginning of this task (SHA256
`b3129521d573035ce05bc8ae85086fe3f3a25093fc26e69d9c72b440f4c4291b`).

## Owned environments

| Purpose | Project/container suffix | Application | Supabase API | PostgreSQL |
| --- | --- | --- | --- | --- |
| Persistent development | `pozanuta-stage1-dev` | localhost:3000 | 127.0.0.1:55521 | 127.0.0.1:55522 |
| Disposable E2E | `pozanuta-stage1-e2e-isolated` | localhost:3105 | 127.0.0.1:55431 | 127.0.0.1:55432 |
| PostgreSQL integration | random UUID-owned Docker container | none | none | random Docker-owned loopback port |

CLI version is pinned to 2.109.1. Development uses a separate CLI workdir in
`.artifacts/local-development`; it never uses historical link metadata from the
repository's `supabase/.temp`. The checked-in `supabase/config.toml` requests PG17,
Auth, Realtime and local Mailpit (55524). Storage, Studio, Edge Functions and
Analytics are disabled because this application does not need them for these
tests. There are no copied production users, business rows, buckets, OAuth
credentials or catalog dumps. Google OAuth and external email delivery are not
configured locally. Auth confirmation is enabled, with the exact local
`http://localhost:3000/auth/callback` redirect and local Site URL.

The neighboring `pozanuta-social` stack on 543xx and previously stopped
`pozanuta-p3-e2e` containers were left alone. Existing archives, benchmark traces
and reports were not deleted. The new E2E runner removes only its own disposable
stack and its existing bounded output directories, retaining failures first.

## Configuration ownership

| Ignored local file | Contents and consumers |
| --- | --- |
| `.env.local` | Local runtime DB URL, public Supabase URL/key, local Site URL and local marker. No Supabase administrator/worker/setup secrets. |
| `.env.admin.local` | Local DIRECT_URL, local Supabase administrative URL/key and synthetic operator bootstrap values. Drizzle/admin scripts only. |
| `.env.auth.local` | Fresh local invite-cookie signing secret; setup token hash is empty, so setup is disabled. Local Next launcher injects only the invite signing secret. |
| `.env.worker.local` | Separate generated local `kunestu_local_import` login and synthetic loopback source. No runtime/admin/Auth credentials. |

Windows user-only ACLs were applied to these files and the synthetic operator
credential file. Local CLI keys are local development credentials, not production
credentials. Runtime/admin DB variables currently address the standard local
Supabase `postgres` login; separating them does not make the runtime login least
privileged. The worker has its own NOINHERIT, non-superuser, non-BYPASSRLS login
with exactly the existing `import_worker` membership, validated by the worker.

`pnpm dev` ignores inherited application/cloud/test credentials and reads the
managed local files. Local build/start do the same. Existing Vercel cloud-build
behavior remains selected on Vercel; no Vercel configuration was applied.
Cloud placeholders remain documented in `.env.example`, with explicit local
setup instructions. Do not run `vercel env pull` over local development files.

## Fail-closed boundaries

- `src/lib/local-target.ts` validates before client creation. Only the two known
  loopback DB ports or ports registered after the PG17 Docker harness establishes
  ownership are allowed. Remote DNS/IPs, production reference, unknown local
  ports, malformed targets and connection-overriding URL parameters are rejected.
  The only allowed query key is bounded `application_name`, used by existing
  concurrency tests; it does not change the connection target.
- Docker fixture ports are unregistered when their containers are removed.
  Child fault tests receive a validated target through a narrow bootstrap and a
  cleaned environment. No production credentials are inherited by those children.
- Administration, migrations, seeds, imports/backfills and workers validate their
  dedicated URLs. Admin scripts load only `.env.admin.local`; workers load only
  `.env.worker.local`. A worker additionally requires a loopback synthetic source.
  Raw Drizzle `push` is not part of the workflow and was not used.
- Local Next configuration checks DB and Auth/API profile consistency at startup.
  Runtime test/development markers cannot bypass the DB guard by setting VERCEL.
  Existing actual Vercel transaction-pooler validation remains unchanged.
- E2E launch builds a new environment from an OS-variable allowlist and explicit
  local credentials returned by its own CLI stack. It drops inherited cloud,
  administrative, worker, invitation, setup and E2E login values. Every Playwright
  configuration and mutating fixture validates the dedicated E2E profile first.
  `tests/e2e/e2e-env.ts` no longer calls dotenv. A regression test scans E2E sources
  for root-env loading. E2E webservers do not reuse an existing application server.
  Local Next, Playwright and Vitest configuration also refuse unmanaged dotenv
  fallback files and variables placed in the wrong role-specific file. Restoring
  a cloud `.env` or `.env.development.local` therefore stops launch rather than
  silently supplying omitted credentials. Generic Playwright storage state now
  uses `.auth/local-isolated`, never a historical shared operator state file.
- Vercel telemetry components are omitted only when `KUNESTU_LOCAL=1`, preventing
  local browser telemetry requests to external Vercel hosts. Cloud behavior is
  unchanged.

These controls protect repository entry points against mistakes. They are not a
sandbox against deliberately bypassing the repository with a raw SQL client,
forging process state, tunneling production through an approved local port or
using the still production-pointing MCP. MCP remains prohibited for local work.

## Commands

```powershell
pnpm local:up
pnpm db:migrate
pnpm local:seed
pnpm dev
```

Synthetic operator credentials and event/session identifiers are stored in the
ignored `.artifacts/local-development/operator.json`; never paste them into logs.
The seed is transactional for business rows and refuses to overwrite an existing
synthetic workspace. It creates one organization, one owner, one event/session
and 20 clearly synthetic songs. A failed business transaction can leave a local
synthetic Auth user; it never deletes data to hide that failure.

```powershell
pnpm local:worker:provision
pnpm import-worker:once
pnpm local:verify                 # requires pnpm dev or pnpm start on port 3000
pnpm test:e2e:public-event-session-identity-local
pnpm test:postgres:public-event-session-identity
pnpm local:down                   # stops only this stack and preserves data
```

Worker provisioning creates a local login, not an application schema migration.
The local source port 55525 is intentionally a synthetic endpoint; no external
import service is contacted. An idle worker verifies identity without importing
anything. Provisioning refuses to rewrite a login whose credentials are missing.

## Verification evidence

Evidence is kept under `.artifacts/local-isolation-*`. Final result counts and
gate status are recorded below after completion; intermediate failures are
retained, not reclassified as successful runs.

- `runtime.json`: normal local sign-in; participant page; queue and live Realtime;
  browser network restricted to the owned app/API; fresh signup, local mail
  confirmation through `/auth/callback`; PG170006; 31 Drizzle migrations;
  `event_participants.merged_into_id` present.
- `negative.log`: actual seed, worker, migration and E2E fixture subprocesses
  reject an unknown listening target with **zero socket connections**, plus
  remote/production/unknown-port/mixed-profile/poisoned-parent negative cases.
- `worker-final.log`: separately provisioned local worker identity accepted,
  one controlled cycle returns `idle`.
- `next-compilation.json`: Next's local MCP endpoint reports `issues: []`.
  `get_errors` without a connected browser cannot establish browser correctness;
  actual Playwright runtime checks provide that evidence instead.

Initial checks found and corrected test/configuration issues: rejection of the
existing safe `application_name` parameter; Mailpit replacing the older Inbucket
API; an incorrect signup button selector in the new smoke script. The first E2E
run exposed a race in its existing merge scenario: proposal refresh began at
11:48:43.751Z, before the preceding done POST completed at approximately
11:48:43.991Z. The test now awaits each canonical 200 response and completed save
before refreshing. No merge/DnD business rules or assertions were weakened.

## Operational limits and rollback

Docker currently publishes local Supabase ports on all host interfaces; do not
expose 55521/55522/55524 to an untrusted network. Host firewall/LAN reachability
has not been certified. This is a local workstation setup, not an Internet-facing
staging service. Physical tablet/touch and remote OAuth/SMTP/Storage are not
claimed as tested by this task.

Physical tablet checklist (not executed, no PASS claimed): approve a controlled
LAN-only endpoint and matching local Auth redirects first; verify touch drag
before/after cards of different heights, page scroll versus handle drag,
auto-scroll at both edges, rejected drop confirmation/cancel, orientation changes,
reconnect during a gesture, two-operator conflicts and persisted order after
reload. Never use the current Production/Preview endpoint for these checks.

Rollback is local only: stop the owned app and use `pnpm local:down` to preserve
the local stack's data. Preserve the generated environment files privately. Do
not copy quarantined production configuration back, reset databases, revert the
whole working tree or undo Enterprise DnD changes. If isolation changes need
reversing, review their file diff separately, keeping all existing task changes.
No production rollback operation is needed because none was performed.

## Separate proposal: Vercel and MCP (NOT applied)

1. User approves an exact nonproduction Supabase project/reference and Vercel
   Preview scope, cost and backup policy. Keep production explicitly excluded.
2. Create a distinct Preview/Staging project with no production data/credentials.
   Apply reviewed committed Drizzle migrations from an empty PG17-compatible
   schema; verify all hashes/history, constraints, RLS, roles and Realtime topics.
3. Provision synthetic Auth users/app memberships, independent keys, exact Auth
   redirects for approved Preview hostnames, isolated SMTP and any actually
   required private storage buckets. Do not use broad production callback rules.
4. Set every generic and branch-specific Preview variable explicitly to this
   project: runtime transaction-pooler DATABASE_URL, public URL/key, Site URL,
   admin URL/key only where needed, independent invite/setup signing values.
   Keep worker credentials separate and production values out of all Preview
   scopes. Migration credentials should belong to a separately approved release
   process, not browser runtime. Development Vercel variables must not be pulled
   into this checkout. Review inherited and legacy branch overrides together.
5. Obtain separate approval to replace the production-pointing `supabase-dev`
   MCP with a verified nonproduction, least-privileged/read-only connection.
   Preserve the private config until then. Do not send a first query merely to
   discover whether the endpoint is production.
6. Run controlled Preview signup/confirmation, RBAC negative paths, participant
   linking, Fair Queue/DnD and Realtime checks after verifying the target and
   schema. Do not point current local-only E2E at Preview by disabling its guard;
   an approved remote test contract needs independent ownership checks.
7. Rollback an incorrect Preview configuration by disabling the affected Preview
   deployment and restoring the last **isolated** configuration. Never restore
   production credentials into Preview. Preserve nonproduction data and prefer a
   reviewed forward fix over destructive schema rollback. Promote nothing to
   production without separate approval.

Production exposure remains **NO-GO** for Preview/deployment until this proposal
is approved and verified. Earlier production audit rows cannot prove whether
historical dev/Preview actions wrote production; origin attribution is missing.
This local setup does not retrospectively establish that no production writes
ever happened.

## Isolation change inventory

- Environment contracts/launchers: `src/lib/local-target.ts`,
  `scripts/isolated-environment.ts`, `scripts/local-environment-files.ts`,
  `scripts/local-development.ts`, `scripts/local-next.ts`,
  `scripts/provision-local-worker.ts`, `scripts/seed-local-development.ts`,
  `scripts/test-target-bootstrap.ts`, `scripts/verify-local-development.ts`,
  `supabase/config.toml`, `package.json`, `.env.example`, `.gitignore`, `tsconfig.json`.
- Connection boundaries: `next.config.ts`,
  `src/server/database-connection-config.ts`, `src/db/admin-database-url.ts`,
  `drizzle.config.ts`, `src/lib/supabase/admin.ts`,
  `src/server/platform-admin/import-worker-process.ts` and the nine existing DB
  administration/seed/import scripts whose dotenv source is now admin-only.
- Local telemetry: `src/app/layout.tsx`.
- Tests: `tests/localEnvironment.test.ts`, `tests/localEnvironmentFiles.test.ts`,
  `tests/localToolIsolation.test.ts`, existing DB-config/worker unit contracts,
  PG17 harness/fault child launcher, all Vitest configuration preflights,
  Playwright configuration/runner/fixture/env helper and the existing merge E2E
  save synchronization. Other existing DnD/ThemeProvider changes predate this task.
- This handoff is new. The generated `.env.*` and synthetic operator credentials
  are ignored/private; they are not source artifacts or commit candidates.

Sources: [Supabase local projects](https://supabase.com/docs/guides/local-development/running-multiple-local-projects),
[local CLI configuration](https://supabase.com/docs/guides/local-development/cli/config),
[Mailpit API](https://mailpit.axllent.org/docs/api-v1/).
