# Platform Admin Dashboard Contract

Status: accepted product and architecture contract; `/admin` implementation not
started. The shared Vitest test foundation is implemented.

Verified against:

- branch `feat/platform-stage-1`;
- commit `a684151`;
- repository state on 2026-07-15.

Related documents:

- [Platform Product Model](../product/platform-product-model.md)
- [Multi-Tenant Platform ADR](../architecture/adr-multi-tenant-karaoke-platform.md)
- [Roadmap Status](../ROADMAP_STATUS.md)

This document does not authorize a migration, database mutation, dependency
change, deployment or production configuration change.

## 1. Reading The Contract

The labels below keep implementation facts separate from future requirements:

- **Existing fact**: verified in the current repository.
- **Accepted decision**: binding product or architecture rule.
- **Recommended implementation**: preferred direction, subject to discovery
  and normal review.
- **Deferred technical decision**: requires a focused ADR or implementation
  discovery before selection.
- **Out of MVP**: explicitly excluded from the first `/admin` release.

Planned routes, services, jobs and protections in this document do not exist
unless they appear under **Existing facts**.

## 2. Existing Facts

Verified in the current repository:

- Supabase Auth SSR resolves identity for the dashboard.
- Active `operator_users` records gate current application access.
- `operator_users.auth_user_id` links local operators to Supabase Auth.
- `workspace_members` provides `owner`, `manager`, `operator` and `viewer`.
- `platform_members` provides `platform_owner`, `platform_admin` and `support`.
- One platform membership row is allowed per operator.
- `platform_members_one_active_owner_idx` permits only one active owner.
- Bootstrap logic recognizes exactly one active owner as initialized.
- `operator_audit_log` stores operator, event, action, entity id, JSON payload
  and timestamp.
- `import_jobs` stores source, current status, initiator, basic counters, error,
  creation time and finish time.
- Current import statuses are `pending`, `running`, `done` and `failed`.
- iSing and KaraFun CLI importers upsert by `(source, source_song_id)`.
- Neither importer truncates or deletes songs.
- iSing supports dry-run, pagination, limits, timeout and response safety; a
  write run creates a basic import job row.
- KaraFun validates CSV headers and maps rows, but runs as a direct CLI write.
- Organization dashboard authorization uses active operator and active
  workspace membership.
- Organization team management is read-only.
- Local shadcn/Radix components, Tailwind v4 and rose/pink OKLCH tokens exist.
- The global app appearance is currently dark.
- `next-themes` is not installed.
- Vitest is configured for isolated new unit/component tests and has one local
  shadcn Button test.
- Existing tests remain on `node:test`; Playwright projects cover public and
  authenticated dashboard flows.

Not implemented:

- `/admin`, its layout, shell, navigation and APIs;
- a reusable platform-membership guard or permission policy;
- platform role-management services;
- application suspension/unlock workflows;
- organization member invite/remove/role-change workflows;
- concurrency-safe last-platform-owner protection;
- a durable import worker, claim, heartbeat, retry or cancellation mechanism;
- KaraFun dry-run and private upload lifecycle;
- one-active-job-per-source database protection;
- retention cleanup or evidence that cleanup ran;
- a platform audit viewer;
- admin light/system theme switching.

## 3. Accepted Product Scope

### Goals

The first `/admin` MVP provides:

- a secure platform route guard;
- a separate `AdminShell` and responsive navigation;
- read-only Overview;
- Imports;
- Users, including application suspension and unlock;
- Organizations;
- read-only Audit.

Target navigation is Overview, Catalog, Imports, Users, Organizations, Events,
Moderation, Audit and System. The MVP renders only implemented and authorized
destinations; it has no dead links.

### Out Of MVP

- replacing `/dashboard/org/[organizationId]`;
- target `organizations`, `venues` or `user_profiles` migration;
- Catalog editor;
- Events, Moderation and System modules;
- profile claims, points, rankings and participant history;
- physical account deletion or Supabase Auth identity deletion;
- audit export;
- database migration, SQL or reset controls;
- secret, password, token or cookie inspection;
- production environment/deployment management;
- selecting a worker, storage provider or scheduler without technical analysis;
- migrating the existing test suite to Vitest;
- redesigning the public site.

## 4. Roles And Permission Matrix

**Accepted decision.** Supabase Auth proves identity. Active local records and
server-side policies grant business permissions. Platform and organization
roles are separate scopes.

Legend: `R` read, `W` mutate, `C` conditional mutation, `-` denied.

| Capability | platform_owner | platform_admin | support |
| --- | --- | --- | --- |
| Open `/admin` and Overview | R | R | R |
| View catalog/import history | R | R | R |
| Start iSing import | W | W | - |
| Upload/validate/run KaraFun import | W | W | - |
| Request import cancellation | W | W | - |
| View users, status and memberships | R | R | R |
| Suspend/unlock a non-owner user | W | W | - |
| Suspend/unlock a `platform_owner` | C | - | - |
| Grant/change/deactivate/remove `support` or `platform_admin` | W | - | - |
| Grant `platform_owner` | W | - | - |
| Change/deactivate/remove `platform_owner` | C | - | - |
| View organizations and memberships | R | R | R |
| View audit | R | R | R |
| Export audit | - | - | - |
| Critical System settings | later | - | - |
| Run database migrations or SQL | - | - | - |

`C` means all of the following:

- actor is a different eligible platform owner;
- target is not the actor;
- operation leaves at least one eligible platform owner;
- check and mutation are concurrency-safe and audited.

Only `platform_owner` may grant, change, deactivate or remove any
`platform_members` role, including owner, admin and support. `platform_admin`
performs no `platform_members` mutations, but may suspend/unlock ordinary users.
It cannot suspend or unlock a `platform_owner`. `support` is read-only.

An eligible platform owner is a user who simultaneously has an active local
application profile, is not suspended, and has an active `platform_members`
membership with role `platform_owner`.

An organization owner can invite, remove and change roles only inside their own
organization. That flow cannot grant platform roles and requires separate
organization last-owner protection.

## 5. Authentication And Authorization Boundary

**Accepted decision.** Every planned `/admin` page and `/api/admin/*` request
must resolve server-side:

1. valid Supabase Auth identity;
2. active, linked local application user;
3. active platform membership;
4. permission for the exact operation.

Organization membership alone never authorizes `/admin`. Client-supplied roles,
actor ids and organization ids are not trusted. Browser code does not read
business tables directly through Supabase.

Planned response behavior:

- missing Auth session: existing safe sign-in redirect for pages, typed `401`
  for APIs;
- inactive, suspended or unlinked application user: safe `403`;
- no active platform membership or insufficient permission: safe `403`;
- inaccessible sensitive target: safe `404` where existence must be hidden;
- invalid input: typed `400` without internal details;
- concurrency/business conflict: typed `409`.

Route handlers remain thin adapters: validate, authorize, call a server service,
map safe errors and return typed data.

## 6. Application Suspension And Unlock

**Accepted decision.** Suspension belongs to the Users MVP and affects
application access only.

Suspension contract:

- requires a non-empty, validated reason;
- is recorded in audit with actor, target, outcome and safe reason;
- does not delete or directly block the Supabase Auth identity;
- preserves platform/organization memberships, requests, history and identity;
- blocks application access until unlock;
- unlock restores application access and is audited;
- self-suspension is forbidden;
- `platform_admin` cannot suspend or unlock a `platform_owner`;
- `platform_owner` may suspend or unlock another owner;
- the last eligible platform owner can never be suspended, deactivated,
  demoted or deleted;
- protection must hold under concurrent requests;
- physical account and Supabase Auth identity deletion are outside the MVP.

**Deferred technical decision.** The current repository has an application
active flag, but this contract does not preselect a column or migration. Before
schema design, discovery must confirm how suspension differs from deactivation,
how reasons and timestamps are represented, and how all existing authorization
paths observe the state consistently.

**Recommended implementation.** Owner-sensitive suspension and platform-role
services must share one eligible-owner policy and durable database defense. The
exact lock/constraint mechanism is selected only after migration review.

## 7. Route And Module Contract

These are planned routes, not current implementation facts.

| Route | MVP | Purpose |
| --- | --- | --- |
| `/admin` | yes | Read-only operational overview |
| `/admin/imports` | yes | Job list and source actions |
| `/admin/imports/[jobId]` | yes | Progress, counters and safe errors |
| `/admin/users` | yes | Search and application access status |
| `/admin/users/[userId]` | yes | Safe user detail and permitted actions |
| `/admin/organizations` | yes | Search and organization state |
| `/admin/organizations/[organizationId]` | yes | Summary and memberships |
| `/admin/audit` | yes | Filtered audit timeline |
| `/admin/catalog` | later | Catalog operations/read model |
| `/admin/events` | later | Platform-wide event operations |
| `/admin/moderation` | later | Reports, claims and moderation |
| `/admin/system` | later | Owner-only critical settings |

The organization route may use existing `workspaces.public_id`. User detail
needs an approved browser-safe identifier; the final identifier is deferred to
data-model discovery.

### Overview

Read-only operational summaries may include platform roles, active application
users, organizations, public/live events, catalog counts, latest imports and
recent safe audit entries. Charts are not required.

### Imports

Owner/admin can create and observe import jobs. Support can observe jobs and
safe errors. iSing can be synchronized again. KaraFun supports private upload,
server-side validation, dry-run and separate confirmed write execution.

### Users

Search and detail expose only authorized account status, Auth linkage state,
organization memberships, platform role and safe audit history. Suspension,
unlock and permitted role changes follow the matrix and last-owner rules.

Passwords, hashes, cookies, tokens, service keys and complete Auth payloads are
never displayed.

### Organizations

Platform staff can search and inspect organization status, memberships, roles,
event counts and safe audit history. The first module is read-only and contains
no organization mutation. Any future platform cross-organization mutation
requires a separate product decision and specification. Organization-owner
self-service remains in the organization dashboard.

### Audit

The MVP is read-only and filters by time, actor, action, target and result. It
renders structured safe summaries, not raw payload dumps. Export is outside the
MVP.

### Platform Audit Foundation

**Recommended implementation.** Before any new administrative mutation writes
audit data, perform discovery of existing `operator_audit_log` readers, writers
and retained rows. Decide during implementation review whether to expand that
table compatibly or introduce a compatible platform audit layer.

All platform mutations then use one server-side audit writer with semantic data
for actor, action, target type/id, outcome, safe reason or summary, and
timestamps. It must sanitize payloads and reject secrets, tokens, cookies,
complete Auth payloads and raw errors. The foundation must preserve compatibility
with existing entries and support 365-day retention from the record creation
time. Exact table and column names are not selected by this contract.

## 8. Import Job Contract

**Accepted decision.** iSing and KaraFun run as durable background jobs. The UI
creates and observes a job; it does not keep the full import HTTP request open.

Minimum lifecycle:

```text
queued -> running -> succeeded
                  -> failed
                  -> cancelled
queued ----------> cancelled
```

Required behavior:

- statuses include `queued`, `running`, `succeeded`, `failed`, `cancelled`;
- source, mode, initiator, lifecycle timestamps, progress, counters and safe
  error information are retained;
- KaraFun job metadata identifies the private source artifact without storing
  the CSV body in the job row;
- only a worker claims and completes a running job;
- authorized owner/admin requests cancellation; a running worker acknowledges
  it at a safe checkpoint;
- terminal states are immutable;
- already committed upserts are not rolled back by cancellation;
- retries are idempotent and may repeat a batch safely;
- songs use the existing `(source, source_song_id)` upsert identity;
- no import deletes songs missing from the latest source response;
- at most one queued/running job per source is enforced durably;
- concurrent job creation yields one job and a safe conflict for the other;
- stale-job recovery is explicit and cannot silently create a second active
  source job.

**Recommended implementation.** Keep durable job state in the application
database, use atomic worker claiming, bounded batches and sanitized stable error
codes. Exact fields, worker ownership tokens and claim SQL are implementation
details reviewed with the migration and worker ADR.

## 9. Retention And Cleanup

**Accepted decision.** Retention periods are:

| Data | Retention clock |
| --- | --- |
| Audit record | 365 days from its creation time (`createdAt` semantics) |
| Import job metadata | 365 days from terminal state time (`terminalAt` semantics) |
| Safe diagnostic detail | 30 days from recording time (`recordedAt` semantics) |
| Private KaraFun source file | no more than 7 days from upload, regardless of job state |

Additional rules:

- KaraFun files may be deleted earlier after diagnostics complete;
- a job that never reaches terminal state requires stale-job recovery and a
  maximum retention period defined by the worker/cleanup ADR;
- file deletion leaves job metadata, counters and an anonymized, sanitized
  summary;
- safe summary data may remain with job metadata for 365 days, while richer
  diagnostic details expire after 30 days;
- secrets, tokens, credentials, login data and raw sensitive errors never enter
  audit or durable logs;
- cleanup runs are operationally verifiable;
- cleanup success, failure and affected record/artifact counts are audited
  without recording deleted sensitive content;
- cleanup cannot extend retention by rewriting the timestamp that anchors a
  retention period;
- audit export is outside the first MVP.

`createdAt`, `recordedAt` and `terminalAt` describe timestamp semantics, not
preselected column names. The compatible schema is chosen during discovery.

**Deferred technical decision.** Private storage provider, scheduler, cleanup
runner and deletion-proof mechanism are not selected. The technical ADR must
define retries, missed-run detection, observability and safe manual recovery.

## 10. Data Change Guidance

No migration is created by this documentation work.

### Required Outcomes

- allow multiple eligible platform owners;
- preserve at least one eligible platform owner under concurrency;
- make all application authorization paths observe suspension consistently;
- retain required suspension reason and audit evidence;
- expand import jobs compatibly to the accepted lifecycle and progress model;
- enforce one active import job per source;
- support retention and verifiable cleanup without storing sensitive payloads;
- support safe platform audit filtering;
- provide a browser-safe user identifier if required by the user detail route.

### Recommended Migration Sequence

1. Discover current data and every read/write authorization path.
2. Expand schema compatibly without breaking CLI imports or dashboard access.
3. Backfill and verify existing owner/import data.
4. Switch services and workers to the expanded model.
5. Add durable constraints/guards only after data and writers are compatible.
6. Verify concurrency, retention and lockout behavior in real Postgres.
7. Retire legacy states or fields only in a later cleanup migration.

The implementation must not assume a suspension column, audit-table rename or
specific lock mechanism before discovery. Migration review must include
read-only verification and rollback/forward-fix notes.

## 11. Deferred Background Infrastructure Decision

The worker, storage provider and scheduler require a dedicated ADR and a small
proof of concept.

| Option | Fit | Strengths | Risks to evaluate |
| --- | --- | --- | --- |
| Database jobs plus dedicated Node worker | Reuses Drizzle and importer code | Portable state and atomic claims | Separate worker hosting and operations |
| Managed queue/workflow plus worker callback | Fits a managed web deployment | Delivery, retries and visibility | Vendor cost, limits, security and local development |
| Supabase-hosted function/cron plus database jobs | Close to current database | Fewer infrastructure vendors | Node importer adaptation, CSV streaming and runtime limits |

A long-running Route Handler, fire-and-forget promise or request-lifetime
extension is not sufficient as the sole durability mechanism.

The ADR decides:

- worker hosting and trigger;
- private storage and upload handoff;
- cleanup scheduler and evidence;
- retry/backoff, heartbeat and stale-job recovery;
- cancellation checkpoints;
- file/runtime/batch limits;
- observability, cost and operational ownership;
- local and integration test strategy.

No option is selected by this contract.

## 12. UI And Theme Strategy

**Accepted decision.** Admin/dashboard UI is:

- shadcn/ui-first using local `src/components/ui` components;
- Tailwind-first;
- based on the accepted rose/pink OKLCH preset;
- dark by default, with light and system modes through `next-themes`;
- scoped so admin/dashboard theme changes do not alter public branding.

Add only components required by real views. Do not import generated dashboard
blocks or create a parallel design system. Prefer Sidebar, Card, Table,
DataTable, Badge, Button, Form, Dialog, AlertDialog, DropdownMenu, Tabs,
Skeleton and Toast where appropriate. Destructive or privilege-changing flows
use `AlertDialog`, never `window.confirm`.

Required UX:

- keyboard-accessible navigation and dialogs;
- visible focus states and labelled controls;
- loading, empty, error, forbidden and success states;
- non-color status cues;
- responsive 320/390 px and desktop layouts;
- no page-level horizontal overflow;
- no public-site theme regression.

`next-themes` and missing shadcn components are future implementation changes,
not existing dependencies.

## 13. Security Requirements

**Accepted decision.** Implementations must:

- keep Supabase service credentials server-only;
- never expose passwords, hashes, cookies, JWTs, tokens or environment values;
- authorize every read and mutation server-side;
- prevent self-suspension, owner escalation and cross-organization access;
- preserve at least one eligible platform owner under concurrency;
- require and audit a safe suspension reason;
- use same-origin/CSRF protection for authenticated mutations;
- validate and cap search, pagination, upload and CSV inputs;
- validate files server-side and store them privately;
- sanitize filenames, errors, audit payloads and logs;
- rate-limit sensitive mutations and upload creation;
- avoid secrets in job parameters;
- audit role, access-state, organization, import and cleanup operations;
- expose structured audit summaries rather than raw JSON;
- provide no migration, SQL or reset controls in `/admin`.

## 14. Testing Strategy

**Accepted decision.** Vitest is preferred for new unit/component tests. It is
added separately without migrating the existing `node:test` suite. Playwright
remains the E2E layer.

Required coverage:

### Unit And Component

- complete permission matrix;
- platform access and suspension decisions;
- reason validation and safe error sanitization;
- import state transitions and progress;
- retention cutoff calculations;
- upload metadata/CSV validation;
- keyboard, focus and role-specific action rendering;
- theme dark/light/system and public-theme isolation.

### Service, API And Database Integration

- no platform access from organization membership alone;
- owner/admin/support positive and negative paths;
- admin cannot grant, change, deactivate or remove any platform role;
- only owner can mutate `platform_members`;
- admin can suspend/unlock an ordinary user; support cannot;
- self-suspension rejection;
- admin cannot suspend or mutate an owner;
- owner can suspend another owner when a different eligible owner remains;
- last owner cannot be suspended, demoted, deactivated or deleted;
- concurrent suspension, demotion, deactivation and deletion cannot reduce
  eligible owners to zero;
- unlock restores application access without losing memberships/history;
- one active source job under concurrent creation;
- atomic worker claim, idempotent retry and cooperative cancellation;
- KaraFun dry-run performs no song writes;
- imports never delete/truncate songs;
- error, audit and cleanup records contain no sensitive payloads;
- audit creation, diagnostic recording, job terminal and KaraFun upload clock
  anchors at their 365/30/365/7-day boundaries;
- KaraFun expiry independent of job state and never-terminal stale-job maximum;
- cleanup cannot extend retention by rewriting an anchor timestamp;
- idempotent cleanup;
- cleanup failure is visible and retryable;
- typed 400/401/403/404/409 API behavior;
- migration backfill, constraints and forward-fix verification.

### Playwright And Runtime Smoke

- each platform role plus an operator without platform membership;
- suspension/unlock and role visibility without exposing auth material;
- import create/observe/cancel paths using safe fixtures;
- mobile/desktop accessibility and theme isolation;
- cleanup/retention runtime evidence in a controlled environment where
  practical.

Source-text assertions may supplement but never replace behavioral tests.
Concurrency and retention claims require real Postgres/infrastructure evidence.

## 15. MVP Acceptance Criteria

Architecture and product decisions are stated above; this section only defines
release evidence.

- All `/admin` pages and APIs enforce the permission matrix.
- Organization membership alone cannot grant platform access.
- Multiple eligible owners coexist and no tested race removes the last one.
- Suspension requires a reason, is audited and blocks only application access.
- Unlock restores application access with memberships/history intact.
- Self-suspension and admin-on-owner suspension are rejected.
- Overview, Imports, Users, read-only Organizations and Audit provide complete
  states.
- Only owner can mutate platform roles; admin performs no `platform_members`
  mutation.
- Owner/admin can run imports; support cannot.
- iSing rerun and KaraFun validation/dry-run/write use durable jobs.
- One active job per source is durable and retries do not duplicate songs.
- No import performs truncate, destructive replace or missing-song deletion.
- Audit/job/error/file retention matches 365/365/30/7 days from creation,
  terminal state, recording and upload respectively.
- KaraFun expiry is independent of job state; never-terminal jobs follow the
  bounded stale-job policy selected in the ADR.
- Cleanup never extends retention by rewriting an anchor timestamp.
- Cleanup is observable, audited and safely retryable.
- Audit export and physical/Auth identity deletion are absent.
- No secret or raw sensitive error reaches browser, audit or durable logs.
- Admin/dashboard theme supports dark/light/system without public regression.
- Required unit, component, integration, API, migration and E2E checks pass.
- `pnpm test`, typecheck, lint, build and diff checks pass.

## 16. Scoped Delivery Tickets

### Ticket 1: Documentation Contract

- **Outcome:** one accepted, reviewable `/admin` contract.
- **Scope:** product model, ADR, roadmap and this specification.
- **Out of scope:** code, dependencies, schema and migrations.
- **Dependencies:** accepted product decisions.
- **Acceptance:** facts, decisions, recommendations and deferrals are distinct.
- **Verification:** link, encoding, whitespace and Git-scope review.

### Ticket 2: Vitest Foundation

**Delivery status:** implemented in `a684151`.

- **Outcome:** a working Vitest runner for new unit and component tests.
- **Scope:** minimal runner/configuration and one test of an existing local
  shadcn component.
- **Out of scope:** migration of existing `node:test` or Playwright suites and
  permission-policy tests; the policy does not exist before Ticket 3, so its
  tests belong to Ticket 3.
- **Dependencies:** Ticket 1.
- **Acceptance:** existing tests remain unchanged and both runners are explicit.
- **Verification:** focused Vitest test plus full current quality gates.

### Ticket 3: Platform Authorization Policy

- **Outcome:** reusable server-side admin guard and permission matrix.
- **Scope:** session resolution, active platform membership, safe errors and
  pure role policy.
- **Out of scope:** UI and role mutations.
- **Dependencies:** Tickets 1-2.
- **Acceptance:** all roles and non-platform operator paths match the matrix;
  only owner receives any platform-role mutation permission.
- **Verification:** unit, service and API negative-path tests.

### Ticket 4: Platform Audit Foundation

- **Outcome:** one compatible server-side audit boundary exists before any new
  administrative mutation is enabled.
- **Scope:** discover `operator_audit_log`; decide compatible extension versus
  platform audit layer; implement the shared writer for actor, action, target
  type/id, outcome, safe reason/summary and timestamps; sanitize payloads;
  support creation-anchored 365-day retention and existing entries.
- **Out of scope:** Audit UI, export, unrelated historical migration and an
  external observability system.
- **Dependencies:** Ticket 3 and migration review if discovery requires a data
  change.
- **Acceptance:** existing entries remain compatible; writer rejects secrets,
  tokens, cookies, complete Auth payloads and raw errors.
- **Verification:** writer, sanitization and compatibility tests; migration
  tests when the selected compatible design changes data structures.

### Ticket 5: Suspension Data Model

- **Outcome:** application suspension, reason and lifecycle are representable
  without changing Supabase Auth identity.
- **Scope:** discovery and a compatible focused migration for suspension audit
  requirements and authorization reads.
- **Out of scope:** suspension services, APIs and UI.
- **Dependencies:** Ticket 3 and migration review.
- **Acceptance:** existing users remain accessible after migration and the
  model can distinguish suspension from other inactive states.
- **Verification:** migration/backfill and authorization-read tests.

### Ticket 6: Multiple-Owner Migration

- **Outcome:** schema and bootstrap can represent multiple eligible platform
  owners.
- **Scope:** data discovery, compatible Drizzle migration, current owner
  preservation and bootstrap eligible-owner semantics.
- **Out of scope:** last-owner guard, role services and admin UI.
- **Dependencies:** Tickets 3 and 5; migration review.
- **Acceptance:** existing owner remains eligible and multiple eligible owners
  can coexist; no mutation endpoint is enabled by this ticket.
- **Verification:** migration/backfill tests and read-only Postgres checks.

### Ticket 7: Last-Owner Database Guard

- **Outcome:** durable database defense preserves one eligible platform owner.
- **Scope:** focused migration implementing the reviewed concurrency guard for
  demotion, deactivation, suspension and deletion effects.
- **Out of scope:** domain services, HTTP APIs and UI.
- **Dependencies:** Tickets 5-6 and accepted migration design; Tickets 6-7 must
  be released together before any platform-role mutation is exposed.
- **Acceptance:** concurrent database transitions cannot reduce eligible owners
  to zero.
- **Verification:** real Postgres concurrency, rollback and forward-fix tests.

### Ticket 8: Platform Role Mutation Services

- **Outcome:** one owner-only domain boundary for all `platform_members`
  mutations.
- **Scope:** grant/change/deactivate/remove services, eligible-owner policy,
  transactions, safe errors and audit writes.
- **Out of scope:** suspension services, HTTP/UI and organization roles.
- **Dependencies:** Tickets 3-4 and 6-7.
- **Acceptance:** admin/support perform no platform-role mutation; owner actions
  preserve one eligible owner.
- **Verification:** unit, service and database integration tests for every role.

### Ticket 9: Suspension And Unlock Services

- **Outcome:** concurrency-safe application suspension and unlock domain
  operations.
- **Scope:** reason validation, self/admin-on-owner rejection, eligible-owner
  checks, transactions, safe errors and audit writes.
- **Out of scope:** Users UI, physical deletion and Supabase Auth blocking.
- **Dependencies:** Tickets 4-5 and 7-8.
- **Acceptance:** ordinary users can be suspended/unlocked by owner/admin;
  owner targets require another eligible owner and owner actor.
- **Verification:** service/API-boundary and real Postgres concurrency tests.

### Ticket 10: AdminShell, Theme And Overview

- **Outcome:** guarded `/admin` shell with read-only Overview.
- **Scope:** scoped navigation, responsive/accessibility states, next-themes
  integration and safe metrics.
- **Out of scope:** import/user/organization mutations.
- **Dependencies:** Ticket 3; approved dependency/component additions.
- **Acceptance:** dark default, light/system work, public branding unchanged.
- **Verification:** component tests, Playwright at 320/390/desktop and build.

### Ticket 11: Import Job Data Foundation

- **Outcome:** durable import lifecycle and retention metadata are representable.
- **Scope:** compatible schema expansion, backfill, active-source protection,
  progress and safe error metadata.
- **Out of scope:** worker provider, storage provider and UI.
- **Dependencies:** Ticket 1 and migration review.
- **Acceptance:** current import data is preserved and one active source job is
  enforced.
- **Verification:** migration, backfill, constraint and rollback/forward-fix
  tests.

### Ticket 12: Worker, Storage And Scheduler ADR

- **Outcome:** one evidence-based infrastructure decision.
- **Scope:** spike and ADR comparing worker, private storage, scheduler,
  retries, cleanup evidence, cost and operations.
- **Out of scope:** production implementation or provider provisioning.
- **Dependencies:** Ticket 11 contract and verified runtime constraints.
- **Acceptance:** selected option satisfies durability, privacy, cancellation
  and 7/30/365-day retention requirements.
- **Verification:** documented proof of concept and architecture/security review.

### Ticket 13: Durable Import Worker

- **Outcome:** import jobs execute durably outside request lifetime.
- **Scope:** atomic claim, heartbeat, bounded batches, retry, cancellation and
  stale-job recovery for iSing and KaraFun.
- **Out of scope:** retention cleanup runner and admin UI.
- **Dependencies:** Tickets 4 and 11-12.
- **Acceptance:** imports are idempotent, non-destructive and cannot create a
  duplicate active source run.
- **Verification:** controlled worker, concurrency, retry and failure tests.

### Ticket 14: Retention Cleanup Runner

- **Outcome:** 7/30/365-day cleanup executes independently and visibly.
- **Scope:** creation/recording/terminal/upload clock anchors; file, safe-error,
  job-metadata and audit cleanup; never-terminal stale-job maximum; retries,
  missed-run detection, sanitized evidence and cleanup audit events.
- **Out of scope:** import execution, storage-provider administration and UI.
- **Dependencies:** Tickets 4 and 11-12.
- **Acceptance:** cleanup is idempotent, never refreshes an anchor timestamp,
  preserves required sanitized summaries and exposes failures without sensitive
  deleted content.
- **Verification:** all clock-boundary, job-state independence, stale-job,
  retry, failure and operational evidence tests.

### Ticket 15: Imports API And UI

- **Outcome:** owner/admin can operate and support can observe imports.
- **Scope:** thin APIs, iSing rerun, private KaraFun upload, validation, dry-run,
  confirmed write, progress, cancellation and safe errors.
- **Out of scope:** catalog editor and provider administration.
- **Dependencies:** Tickets 3-4 and 10-14.
- **Acceptance:** matrix enforced and browser never receives credentials or raw
  files/errors beyond authorized safe responses.
- **Verification:** unit/API/component tests and Playwright with safe fixtures.

### Ticket 16: Users, Roles, Suspension And Unlock UI

- **Outcome:** complete Users MVP with safe application access management.
- **Scope:** search/detail UI and thin APIs over Tickets 8 and 9 for owner-only
  platform roles, suspension, unlock and safe audit history.
- **Out of scope:** physical deletion, Auth identity deletion/block and export.
- **Dependencies:** Tickets 3-4 and 8-10.
- **Acceptance:** every matrix rule and last-owner race is enforced; identity,
  memberships and history survive suspension.
- **Verification:** service/API/component tests plus role-specific Playwright.

### Ticket 17: Read-Only Organizations

- **Outcome:** all platform roles can inspect organizations without mutating
  them.
- **Scope:** search, detail, status, memberships/roles, event count and safe
  audit history.
- **Out of scope:** every organization mutation and target organization model.
- **Dependencies:** Tickets 3 and 10.
- **Acceptance:** module exposes no mutation action/API; organization-owner
  management remains in the organization dashboard.
- **Verification:** API/component/Playwright read tests and mutation-absence
  checks.

### Ticket 18: Read-Only Audit

- **Outcome:** authorized platform roles can inspect sanitized audit history.
- **Scope:** filters, structured summaries and retention/cleanup visibility.
- **Out of scope:** export, raw payload display and audit mutation.
- **Dependencies:** Tickets 4, 10 and 14; audit producers from Tickets 8-9,
  13 and 15.
- **Acceptance:** all roles are read-only and no secret/raw sensitive error is
  exposed.
- **Verification:** authorization, sanitization, retention and Playwright tests.

### Ticket 19: End-To-End Hardening

- **Outcome:** release evidence for the complete MVP contract.
- **Scope:** full role matrix, owner races, import lifecycle, suspension,
  retention evidence, accessibility, responsive/theme and operational runbook.
- **Out of scope:** Catalog, Events, Moderation, System and production rollout.
- **Dependencies:** Tickets 2-18.
- **Acceptance:** all MVP acceptance criteria are evidenced with no known
  critical security or lockout defect.
- **Verification:** full unit/integration/API/migration/Playwright suite,
  runtime smoke and project quality gates.

## 17. Risks And Stop Conditions

High risks:

- dropping the single-owner index before durable last-owner protection;
- treating suspension as an Auth identity mutation;
- checking owner count outside the mutation transaction;
- running imports or cleanup only inside request lifetimes;
- storing raw errors, CSV rows, credentials or secret-bearing URLs;
- retaining KaraFun files past 7 days without visible failure;
- treating cancellation as rollback of committed upserts;
- relying on source-text tests for concurrency or retention evidence.

Stop implementation when:

- existing data has no eligible platform owner;
- migration cannot preserve current owner/import data;
- owner or job concurrency cannot be proven in real Postgres;
- worker/storage/scheduler ADR is missing before provider-specific code;
- private KaraFun storage or cleanup evidence cannot be secured;
- implementation requires destructive catalog synchronization;
- any path would expose secrets, tokens or raw sensitive errors;
- scope expands into target organizations/venues/user profiles.

## 18. Deferred Technical Decisions

Suspension semantics and retention periods are accepted and must not be
reopened. The following implementation choices remain deferred:

- representation of suspension state, reason and lifecycle after discovery;
- exact database/locking defense for the last-owner invariant;
- worker/queue provider and stale-job recovery policy;
- private KaraFun storage provider and upload handoff;
- cleanup scheduler and operational proof mechanism;
- exact import-job fields, claim token and progress update strategy;
- browser-safe user identifier;
- whether to expand `operator_audit_log` in place or generalize it later;
- job observation mechanism before optional Realtime invalidation.
