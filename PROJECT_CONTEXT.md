# PROJECT_CONTEXT

> Status: verified
> Verified against: commit `e36069e`, 2026-07-11
> Describes: current implementation and accepted target direction
> Owner: Tech Lead
> Branch: `feat/platform-stage-1`

## 1. Executive summary

Poza Nutą is transitioning from a single-organizer karaoke queue application into a nationwide multi-tenant karaoke platform. The accepted target model is defined by the product model and architecture ADR. PROJECT_CONTEXT.md and docs/ROADMAP_STATUS.md describe the implementation baseline verified on 2026-07-11.

The current code already implements a substantial Stage 1 slice:

- neutral public discovery and event catalog;
- informational `/events/[slug]` pages;
- event-scoped guest access through `/session/[code]`;
- independent `songRequestsEnabled` and `publicQueueEnabled` capabilities;
- session-scoped song search, request creation, queue reads and Realtime invalidation;
- organization-scoped dashboard routes and RBAC foundation;
- Supabase Auth SSR with local application authorization;
- Drizzle/Postgres persistence and committed migrations through Stage 1 event fields;
- signup, profile onboarding and initial platform setup;
- CLI catalog imports and queue operation workflows.

The application is not production-ready. The largest gaps are public endpoint abuse protection, production/runtime verification, database-backed E2E coverage, observability, backup/rollback operations and target-model migration beyond the transitional workspace/operator/event schema.

## 2. What we are building

### Users and roles

- Guest participant: discovers events and can submit requests through a valid event session link without an account.
- Registered participant: target role with account history and later points; current signup still creates a transitional `operator_users` profile.
- Organization member: receives owner, manager, operator or viewer permissions through membership.
- Event operator: current queue operations are organization-member based; target model adds event-specific staff assignments.
- Venue manager: target role, not implemented as a separate domain relation.
- Platform moderator/owner/admin/support: partial platform membership foundation exists; moderation flows are not implemented.

### Problem and value

The platform should let people find karaoke events across Poland and let independent organizers operate event-specific request and queue workflows without relying on one global Poza Nutą event.

### Main workflows

1. Discover public events from `/` and `/events`.
2. Read an informational event page at `/events/[slug]`.
3. Enter a concrete event session through `/session/[code]`.
4. Search the catalog and submit a guest song request if `songRequestsEnabled` is true.
5. View the event queue if `publicQueueEnabled` is true.
6. Authenticate to the dashboard through Supabase Auth.
7. Resolve local operator profile and organization membership server-side.
8. Create/manage events and operate event-scoped queues according to role.

## 3. Why we are building it

The accepted product direction is a neutral nationwide karaoke discovery and operations platform. `@PozaNuta` is one organizer, not the definition of the entire product. This removes the old dependency on one default workspace and one globally active public event.

## 4. Current stage

The repository is best classified as Stage 1 platform transition, not a finished MVP and not the old single-organizer app.

`PROJECT_CONTEXT.md` and `docs/ROADMAP_STATUS.md` are synchronized against
implementation baseline `e36069e` on 2026-07-11. The accepted product model and
ADR dated 2026-07-10 remain the product and architecture sources of truth.
`docs/project-roadmap.md` may still contain older operational sequencing and
should be read as strategic history/planning context until reconciled. The
current-to-target audit dated 2026-07-10 is now a historical audit of the
pre-Commit-1/Commit-2 worktree: its target model and migration recommendations
remain useful, but findings about global request flow, homepage branding and
capability coupling no longer describe the current implementation after:

- `328b992 fix: remove global queue and restore session-scoped flow`;
- `e36069e feat: add event discovery homepage and directory`.

## 5. Current state versus target state

### Current implementation

- `workspaces` act as transitional organizations.
- `operator_users` act as local profiles linked to Supabase Auth.
- `workspace_members` provide organization roles.
- Events contain both legacy fields (`autoCloseAt`, `isActivePublicEvent`) and Stage 1 fields (`endsAt`, `songRequestsEnabled`).
- One active public event per workspace remains a database invariant for legacy/current dashboard flows.
- Public catalog phase is computed from `startsAt` and `endsAt`.
- Public request creation and public queue access are session-code scoped.
- Global public request and queue endpoints are 410 tombstones.
- A global public song catalog search endpoint still exists by explicit current tests.

### Accepted target

- Explicit organizations, venues, public profiles, user profiles and event staff.
- Case-preserving public `@handle` model.
- Multiple simultaneous live events without a global active-event source of truth.
- Concrete event ownership for every request.
- Optional event capabilities.
- Guest continuity sessions separate from event access links.
- Moderation, profile claims, performance history and later points ledger.

## 6. Repository map

- `src/app`: Next.js App Router pages and API adapters.
- `src/components`: public, dashboard, Realtime and local shadcn UI.
- `src/server`: business services, authorization, session/public/operator APIs and runtime diagnostics.
- `src/db`: Drizzle schema, imports, seed and database checks.
- `src/lib`: pure domain, route, validation, lifecycle and Supabase helpers.
- `drizzle`: committed PostgreSQL migrations.
- `tests`: Node test suite plus conditional Playwright E2E tests.
- `docs/product`: accepted product direction.
- `docs/architecture`: target ADR and current-to-target audit.
- `.agents/skills`: project-specific engineering rules.

## 7. Architecture and data flow

### Public event discovery

Browser/server page -> public route/service -> Drizzle -> Postgres -> public DTO.

Public event pages are informational and do not authorize requests.

### Guest session request

`/session/[code]` -> SHA-256 code hash lookup -> `event_access_links` -> concrete event -> phase/capability validation -> transactional song lookup and request insert.

The plaintext session code is returned only at creation time. The database stores only its hash.

### Dashboard authorization

Supabase Auth session -> `operator_users.auth_user_id` -> active local operator -> active `workspace_members` relation -> active workspace -> role-specific server-side operation.

### Realtime

Postgres trigger -> Supabase Realtime broadcast -> browser invalidation signal -> refetch through application API. Realtime payloads are not the business data API.

## 8. Domain model and glossary

- Platform account: Supabase Auth identity plus local application profile.
- Workspace: current organization-like tenant, not the final organization model.
- Organization: target operational owner/team.
- Venue: target physical place, separate from an organization.
- Event access link: organizer-issued bearer code resolving one event; not a guest continuity session.
- Event capability: currently separate booleans for song requests and public queue; target may use an explicit capability model.
- Event phase: upcoming, live, ended or cancelled, derived from time and state.
- Song request: event-scoped queue item with current legacy-compatible statuses.
- Realtime broadcast: invalidation only; clients refetch authorized data.

## 9. Data, auth, permissions and integrations

### Data

- PostgreSQL through Drizzle and `postgres`.
- Serverless-safe connection settings: max 2 connections, prepared statements disabled and statement timeout configured.
- RLS is enabled on business tables. Browser code does not use Supabase table APIs for business data.

### Auth and permissions

- Supabase Auth proves identity.
- Local `operator_users`, `workspace_members` and `platform_members` decide business access.
- Protected dashboard reads and mutations are intended to enforce authorization server-side.
- Organization routes use non-sequential `workspaces.public_id` and return 404-style denial for missing membership.

### Integrations

- Supabase Auth, Postgres and Realtime.
- iSing catalog import under documented data-access restrictions.
- KaraFun CSV import.
- Vercel-compatible Next.js target.
- Client-side QR rendering through `qrcode`.

## 10. Feature inventory

| Feature | Current status | Evidence | Target |
| --- | --- | --- | --- |
| Neutral public homepage | implemented and tested | `src/app/(public)/page.tsx`, discovery components, tests | expand national discovery UX |
| Public event directory/detail | implemented and tested | `src/app/(public)/events`, public service, tests | add organizer/venue/profile relations |
| Session event resolution | implemented and tested | `src/server/session-api/service.ts`, session tests | retain concrete event resolution |
| Guest song request | implemented at service/API/UI level | session API, UI and source/contract tests | add abuse protection and guest continuity |
| Public queue | session-scoped and capability-gated | session service/UI, Realtime tests | retain event scope, expand request lifecycle |
| Global public queue/request | removed through 410 tombstones | route files and tests | remain removed |
| Dashboard auth | implemented | Supabase SSR plus local operator checks | move toward normal user profile model |
| Organization routing | implemented foundation | org routes, membership resolver, tests | migrate workspace to explicit organization model |
| Event management | implemented on transitional schema | org services/pages/tests | retire legacy active-event fields later |
| Event-scoped operator queue | implemented | event queue services/routes/UI/tests | add event staff assignment model |
| Event access link/QR | implemented | hash-only links, share UI and tests | decide long-lived room code UX separately |
| Signup/profile onboarding | implemented | routes, services and tests | align local account model with user profiles |
| Venues/public profiles | not implemented as target entities | schema audit | Stage 2 |
| Moderation/claims | planned | product model only | later stage |
| Guest continuity/history | planned | product model only | later stage |
| Performances/points | planned | product model only | later stage |
| Rate limiting/anti-spam | missing for public session/catalog endpoints | no middleware/service guard found | required before broad production |
| Production observability | missing | no Sentry/incident workflow | required before production |
| Backup/restore runbook | missing | deployment docs do not provide a verified operational procedure | required before risky production migrations |

## 11. Quality gates and test coverage

### Verified locally

- `pnpm test`: passed, 254/254.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm build`: passed.
- `git diff --check`: passed before Commit 2 staging.
- Git branch and implementation baseline were verified in the real worktree:
  `feat/platform-stage-1` at `e36069e`.
- Remote push/publication state was not confirmed as published in this
  documentation sync.
- Playwright tests exist across public, dashboard auth setup and dashboard
  projects.

### Not verified

- Full production browser smoke on Vercel.
- Full authenticated production dashboard smoke.
- Full database-backed E2E coverage for every critical path.
- Production Vercel deployment, environment variables, auth redirects,
  Realtime and database identity.

### Coverage quality

The Node suite is broad but mixes genuine unit tests with source-text assertions. Source-text checks protect architecture conventions but do not prove database concurrency, runtime authorization or browser behavior. Critical paths still need database integration and Playwright evidence.

## 12. Sources of truth and hierarchy

1. Current code for implemented behavior.
2. Current Drizzle schema and ordered migrations.
3. Product model.
4. Accepted architecture ADR.
5. Tests for covered contracts.
6. Current Git tracker/status from the real repository.
7. `PROJECT_CONTEXT.md` and `docs/ROADMAP_STATUS.md` for the current verified
   implementation and operational snapshot.
8. `current-to-target-model-audit.md` as a historical implementation audit and
   target migration reference.
9. `docs/project-roadmap.md` as older planning context.
10. Chat decisions only after transfer into an accepted source of truth.

## 13. Accepted decisions and ADRs

- Poza Nutą is a nationwide multi-tenant platform.
- `@PozaNuta` is one organizer.
- One technical account can hold multiple roles.
- Organization and venue are separate entities.
- Public event pages are informational.
- Guest song requests remain possible without an account.
- Public request operations require a valid event session link resolving a concrete event.
- `songRequests` and `liveQueue` are independent.
- Multiple events may be live simultaneously.
- Public phase comes from time and explicit state.
- Supabase Auth is identity only; local records own authorization.

## 14. Risks, debt and contradictions

### High risk

- Public session request/search endpoints have no application rate limiting or anti-spam control. This is a production blocker and also matters for iSing-friendly load behavior.
- The critical session flow has source tests and unit/integration-style tests,
  but no confirmed browser/database runtime smoke for the critical session flow.

### Medium risk

- `createSessionRequest` computes `max(position) + 1`. It locks the resolved access-link row, not the event or queue. The new organization event flow revokes older links, but the legacy active-event access-link API can create multiple active links for one event. Concurrent requests through different active codes can therefore race and create duplicate positions. This needs a focused database integration test and an event-scoped locking/idempotency decision.
- Current schema contains both target-direction and legacy lifecycle fields. Dual concepts can drift until a staged migration retires `autoCloseAt`, `isActivePublicEvent` and the single-active-event helper paths.
- Public signup currently creates a transitional `operator_users` record for every account. That is workable for Stage 1 but is not the final one-account/user-profile model.
- The 2026-07-10 audit includes historical findings already fixed in the
  current code. Treat it as historical unless a finding is re-confirmed against
  current HEAD.
- Current tests rely substantially on reading source files and matching strings. This catches accidental architecture regressions but can stay green while runtime SQL, auth, concurrency or browser behavior is wrong.

### Accepted residual risk for Stage 1

- Organization, venue and public profile remain collapsed into transitional workspace/text fields.
- Queue request statuses remain the current smaller set.
- Event access links are bearer secrets with a minimum length of 16; a separate short human-entry room code is not implemented.
- Public Realtime exposes only minimal invalidation payloads and refetches business data through application APIs.

## 15. Open questions

1. Is there already a live Vercel/Supabase environment that should be treated as the current demo environment, or is local/dev still the only authorized target?
2. After the current worktree is committed cleanly, should the immediate business priority be runtime verification/deployment or further local platform development?

## 16. Recommended next step

After the two local Stage 1 commits, the next step is to verify and harden the
runtime behavior before another model expansion:

1. run or record local runtime smoke for public discovery and `/session/[code]`;
2. add database-backed verification where source-text tests are currently the
   main guard;
3. decide and implement public endpoint rate limiting/anti-spam;
4. prepare production smoke notes before any broad launch;
5. then choose one vertical task, preferably hardening the session request flow
   before Stage 2 organizations, venues and public profiles.

Do not start public profiles, venues, points or another broad redesign until the current Stage 1 state is committed, reproducible and runtime-smoked.

## 17. Coverage ledger

| Area | Sources reviewed | Coverage | Confidence | Missing |
| --- | --- | --- | --- | --- |
| Product direction | product model, ADR, audit | full | high | open policy decisions remain explicit |
| Repository instructions | root `AGENTS.md`, architecture/testing/security skills | full | high | none for onboarding |
| Routes/UI | complete route/file map, representative public/session/dashboard components | representative | high | full visual QA |
| Public/session services | service, validation, capability and route files | full for Stage 1 seam | high | real DB/browser execution |
| Auth/RBAC | Supabase session, auth policy, organization access and representative routes | representative | medium-high | exhaustive mutation matrix |
| Database | full schema and migrations 0000-0012 | full | high | live DB state and migration journal verification |
| Realtime | migrations, hooks and queue tests | representative | medium-high | two-browser runtime smoke |
| Imports | docs, scripts map and passing tests | representative | medium | live import state not queried |
| Tests | package scripts, all Node tests, Playwright config and test list | full inventory | high | successful browser/auth/DB E2E |
| Git/history | real worktree status, branch and implementation baseline `e36069e` | full for current sync | high | remote push/PR state not inspected |
| Deployment/operations | deployment/status docs and build | representative | medium | live Vercel/Supabase evidence |
| Secrets | `.gitignore`, `.env.example` and metadata-only archive inspection | representative | medium | secret contents intentionally not inspected or verified |

## 18. Evidence index

### Facts

- The current application is one root Next.js App Router project.
- Node test suite passes 254/254.
- Typecheck, lint and production build pass locally.
- Public request creation and queue reads are session-code scoped in current code.
- Global public request and queue endpoints are tombstones.
- Current migrations include `endsAt`, `songRequestsEnabled` and cancelled event status.
- Target organization, venue and public profile tables do not yet exist.

### Inferences awaiting confirmation

- Stage 1 should be hardened and runtime-verified before Stage 2 model
  expansion.
- Event-scoped queue position serialization is likely needed if multiple active
  session codes remain possible.

### Decisions needed

- Choose immediate post-commit business priority.
- Confirm which environment, if any, is authorized for runtime verification.
