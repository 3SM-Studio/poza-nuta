# Current To Target Model Audit

> Historical note, 2026-07-11: this document is an audit of the worktree before
> `328b992 fix: remove global queue and restore session-scoped flow` and
> `e36069e feat: add event discovery homepage and directory`. Sections that
> describe global public request flow, coupled request/queue capability, or a
> Poza Nutą-branded homepage do not describe the current implementation after
> those commits. The target model and migration recommendations remain
> applicable. For current implementation status, read `PROJECT_CONTEXT.md` and
> `docs/ROADMAP_STATUS.md`.

Status: historical worktree audit and target platform model reference.
Date: 2026-07-10.
Branch observed: `feat/public-event-directory-list`.
Scope: current schema, services, dashboard, public request flow and the
uncommitted public catalog/lifecycle diff.

No application code, migrations, Supabase data or production configuration are
changed by this document.

Related documents:
- [Product Model](../product/platform-product-model.md)
- [ADR: Multi-Tenant Karaoke Platform](./adr-multi-tenant-karaoke-platform.md)

Decision labels:
- **Accepted decision**: binding product or architecture decision imported from
  the product model and ADR.
- **Future recommendation**: migration or implementation recommendation.
- **Open decision**: unresolved product, policy or implementation detail.

## Confirmed Target Product Model

**Accepted decision.** The source of truth for this section is the
[Product Model](../product/platform-product-model.md) and
[ADR](./adr-multi-tenant-karaoke-platform.md).

Poza Nuta is a nationwide karaoke platform, not only the website for events run
by the Poza Nuta team.

`@PozaNuta` is one organizer profile on the platform.

The homepage should be a neutral karaoke discovery entry point:

- headline: `Znajdz karaoke blisko siebie`;
- subtitle: `Odkrywaj wydarzenia karaoke w calej Polsce, sprawdzaj lokale i organizatorow oraz zglaszaj swoje piosenki.`

The target model has:

- one account model;
- roles derived from organization memberships and event staff assignments;
- guest song requests without mandatory account;
- event capabilities instead of feature assumptions;
- concrete `eventId` for every request;
- no global active public event;
- no global block on overlapping event time windows;
- public phase computed from `startsAt`, `endsAt`, cancellation and
  closed-early state;
- organizations and venues as separate domain entities;
- case-preserving, case-insensitive public profile handles.

## Assumptions Frozen For Implementation Planning

**Accepted decision.**

- Supabase Auth remains identity only.
- Local tables remain the source of business permissions.
- Browser code must not read business tables through Supabase.
- Public request creation can be anonymous, but must be entered through a valid
  event access link such as `/session/[code]`.
- A logged-in user may optionally link a request to their profile.
- Publishing an event does not mean the event has started.
- Many events may be live at the same time.
- Event publication does not require platform queue usage.
- Points are awarded for confirmed performances, not request creation.
- Handles use a canonical case-preserving value plus normalized uniqueness.
- MVP ordinary users do not need public `@handle` pages.
- First public publication by a new organizer is subject to moderation.

## Open Product Decisions

- Monetization model.
- Detailed organizer verification process.
- Detailed public profile claim process.
- Guest request cancellation policy.
- Exact moderation policy for first public publication by a new organizer.
- Whether venue creation is open to every verified user in the first public
  signup stage.
- Claim proof model for public profiles: manual, automated or hybrid.
- Whether ended and cancelled events remain publicly discoverable forever.
- Guest session recovery and claim UX.
- Notification channels for approaching queue turns.
- Which event capabilities ship in the first implementation phase.
- Public ranking and point visibility rules.
- Exact mechanism for assigning a guest performance to a user account.
- Data retention and anonymization policy.

## Previously Assumed Without Confirmation

**Audit finding.** These are not accepted decisions.

The current uncommitted diff and earlier implementation steps assumed several
things that are not valid under the confirmed platform model:

- the homepage can be primarily branded around Poza Nuta events;
- public request acceptance can be derived from `publicQueueEnabled`;
- one default workspace can supply the current public event;
- `status = active` or `isActivePublicEvent` can drive public discovery;
- overlapping public event windows should be blocked;
- text `venue` and `city` are enough for the long-term venue model;
- event publication and platform queue availability are tightly coupled;
- `/events` can be treated as secondary to a Poza Nuta-branded home page.

## Current Database Model

**Audit finding.**

Source of truth: `src/db/schema.ts`.

### Current Enums

- `event_status`: `draft`, `active`, `closed`.
- `event_visibility`: `private`, `public`.
- `song_source`: `ising`, `karafun`, `manual`.
- `song_request_status`: `pending`, `approved`, `now`, `done`, `skipped`,
  `rejected`.
- `song_request_source`: `public`, `operator`.
- `import_source`: `ising`, `karafun`.
- `import_job_status`: `pending`, `running`, `done`, `failed`.
- `workspace_member_role`: `owner`, `manager`, `operator`, `viewer`.
- `platform_member_role`: `platform_owner`, `platform_admin`, `support`.

### Current Tables And Constraints

`workspaces`

- Current role: organization-like tenant.
- Fields include `publicId`, `name`, `handle`, `active`.
- Unique `publicId`; unique kebab-case `handle`; active index.
- Target gap: no public profile, no case-preserving handle, no venue separation.

`events`

- Current role: event under a workspace.
- Fields include `workspaceId`, `name`, nullable `slug`, text `venue`, text
  `city`, `startsAt`, nullable `autoCloseAt`, `status`, `visibility`,
  `publishedAt`, `isActivePublicEvent`, `publicQueueEnabled`,
  `publicShowSongTitles`, `closedAt`.
- Constraints include one active public event per workspace, partial unique slug,
  public catalog index, active-public status check, slug format check and public
  requires slug/publishedAt check.
- Target gap: no `leadOrganizerOrganizationId`, `venueId`, `endsAt`,
  capabilities, cancellation/postponement model, event organizations or event
  staff.

`operator_users`

- Current role: local dashboard operator profile.
- Unique lower(name); unique `auth_user_id` when present.
- Target gap: should become or be bridged to `user_profiles`; business roles
  should come from memberships and event staff, not from a separate technical
  account type.

`workspace_members`

- Current role: workspace membership with role.
- Target mapping: `organization_memberships`.
- Target gap: no explicit target organization table yet; no venue management or
  event staff assignments.

`platform_members`

- Current role: platform support/admin/owner membership.
- Compatible conceptually with platform-wide roles.

`event_access_links`

- Current role: organizer-issued event access links for `/session/[code]`,
  resolving one concrete event id.
- Compatible as a transition mechanism if scoped and audited.
- Target gap: guest continuity sessions and claim flows need separate token
  design; they are not the same as event access links.

`song_requests`

- Current role: queue/request rows tied to `eventId` and `songId`.
- Good fact: `eventId` is already required.
- Target gap: statuses need expansion; guest/user profile linkage and request
  session linkage are missing.

`operator_sessions`

- Current role: legacy local operator sessions.
- Target gap: dashboard identity should rely on Supabase Auth plus local records.

`operator_audit_log`

- Current role: operator audit trail.
- Target mapping: broader `audit_logs`.

`import_jobs`

- Current role: catalog import state.
- Mostly orthogonal to the platform model.

## Current Services And Flows

**Audit finding.**

### Public Event Listing

`src/server/public-api/service.ts` has `listPublicEvents()`.

The current diff filters public events by:

- `visibility = public`;
- non-null `slug`;
- non-null `publishedAt`.

It sorts by a computed live/upcoming/ended grouping and caps the MVP catalog at
50 rows.

This is directionally compatible, but it still uses the current event table:
text venue/city, `autoCloseAt` instead of `endsAt`, and no organizer/venue
profile relations or capabilities.

### Public Event Detail

`src/app/events/[slug]/page.tsx` reads through the public service, which is good
for the server boundary.

The public event detail page is informational. It must not render the request
form and the public slug must not authorize creating a request. Song requests
start from `/session/[code]`, where the code resolves the concrete event id.

### Public Request Flow

`createPublicRequest()` currently still selects one event by joining
`workspaces` and filtering `workspaces.handle = DEFAULT_WORKSPACE_HANDLE`.

It also filters by:

- public visibility;
- `publicQueueEnabled = true`;
- non-null slug and publishedAt;
- not closed;
- `startsAt <= now`;
- `autoCloseAt > now`.

This is incompatible with the target platform model.

Target flow superseded by the Stage 1 session decision:

1. Request enters through `/session/[code]`.
2. Backend resolves the code to exactly one event.
3. Backend validates publication and public visibility.
4. Backend validates `songRequests` capability.
5. Backend validates phase from `startsAt` and `endsAt`.
6. Backend rejects cancelled, postponed-away or closed-early events.
7. Backend creates the request for that exact event.

### Search And Public Queue

`searchPublicSongs()` and `getPublicQueue()` still call the active public event
helper path. Those flows remain single-organizer/current-event based and need a
target design:

- search can be global song catalog search, optionally event-scoped by
  capability;
- public queue must be scoped to a secure session code.

### Dashboard

The dashboard currently uses `workspaces` as organizations and
`workspace_members` as organization memberships.

Current diff moves new organization events toward draft/public publication
fields and away from manual `isActivePublicEvent` controls. That is useful
directionally.

However, the diff also adds
`EVENT_PUBLICATION_TIME_OVERLAP`, blocking overlapping public event windows
inside a workspace. That conflicts with the confirmed platform model because
multiple events can be live at the same time and overlap is not globally
forbidden.

### Signup And Setup

The `/setup` flow and platform owner bootstrap are outside this feature's
implementation scope. Conceptually they remain compatible if they create the
first platform owner and first organization without creating an event.

Future public signup must create a normal user account/profile. Organizer,
venue manager and operator abilities must come from memberships.

### Legacy Active Event Model

The current code still contains `getActivePublicEvent`,
`getActivePublicEventReadOnly`, `isActivePublicEvent`, `status = active` and a
single-active-public-event index.

These are current-app implementation details. They can be retained temporarily
for legacy operator/session routes, but target public catalog and request flows
must not depend on them.

## Current Diff Classification

**Audit finding.**

This section classifies the actual uncommitted diff observed on
`feat/public-event-directory-list`.

### 1. Generic And Compatible With The New Model

- `src/lib/public-event-list.ts`: catalog grouping and sorting helper is useful
  if fed by target public status. It must remain a pure helper and not own
  domain phase rules.
- Parts of `src/app/events/[slug]/page.tsx`: server-side public detail route is
  a compatible route shape.
- Parts of `src/components/public/api.ts`: public event DTO shape can survive if
  expanded with event id, organizer, venue and capabilities.
- Parts of `tests/e2e/public.spec.ts`: browser smoke coverage for public pages
  is reusable after copy and route expectations are updated.

### 2. Correct After Minor Correction

- `src/lib/event-phase.ts`: the concept is correct, but target input must use
  required `endsAt`, not nullable `autoCloseAt`, and must include
  cancelled/postponed/closedEarly handling.
- `src/lib/public-event-contract.ts`: contract assembly is useful, but it needs
  event id, organizer/venue fields and capability-aware `requestsEnabled`.
- `src/app/events/page.tsx`: a public `/events` route can exist, but the target
  homepage decision should be clarified first because `/` is the primary neutral
  search entry point.
- `src/components/public/public.module.css`: some responsive visual styling may
  be reusable after removing single-organizer marketing assumptions.
- `src/components/operator/create-event-form.tsx`: scheduling/publication fields
  are directionally useful, but labels and target data model need `endsAt` and
  capabilities.
- `src/components/operator/event-management-panel.tsx`: removing manual active
  controls is directionally useful, but the form still speaks in current
  `autoCloseAt`/queue booleans.
- `src/lib/dashboard-event-lifecycle.ts`: useful as a dashboard lock helper if
  rewritten around target event lifecycle.
- Parts of `tests/eventLifecycle.test.ts` and `tests/publicEvents.test.ts`:
  phase and sorting tests are reusable after updating target semantics.

### 3. Based On The Single-Organizer Model

- `src/app/page.tsx`: metadata and positioning are still Poza Nuta-event
  branded, not the confirmed neutral nationwide search model.
- `src/components/public/public-events-directory.tsx`: hero, navigation and CTA
  are written as "Poza Nuta Karaoke" and "invite us to a venue" instead of a
  neutral platform.
- `src/server/event-lifecycle.ts`: `DEFAULT_WORKSPACE_HANDLE` and active public
  event lookup remain central.
- `src/server/public-api/service.ts`: historical finding superseded for
  Stage 1 by session-scoped requests; public event detail remains
  informational, and request/search/queue capabilities belong under
  `/session/[code]`.
- `src/lib/public-request-eligibility.ts`: uses `publicQueueEnabled` as request
  eligibility instead of a `songRequests` capability.
- `src/app/events/[slug]/page.tsx`: historical finding superseded for
  Stage 1; the page should remain informational and must not expose request
  creation.
- `tests/publicApi.test.ts`: protects active public event source-code behavior
  and default current-event assumptions.

### 4. Requires Revert Or Rewrite

- `src/server/operator-api/organizations.ts`: the overlap validation
  `assertNoPublishedEventWindowOverlapInTransaction` and
  `EVENT_PUBLICATION_TIME_OVERLAP` conflict with the confirmed "many
  simultaneous events" model.
- `src/app/dashboard/org/[organizationId]/events/[eventId]/page.tsx`: handling
  for `EVENT_PUBLICATION_TIME_OVERLAP` should be removed with the overlap
  policy.
- `tests/dashboardOrganizationRouting.test.ts`: assertions requiring
  `EVENT_PUBLICATION_TIME_OVERLAP` protect the wrong invariant.
- Any route or test path that keeps public request creation without a valid
  event access link resolving a concrete event id needs rewrite rather than
  incremental polishing.

### 5. Tests Protecting Wrong Assumptions

- `tests/publicApi.test.ts`: source-text checks around
  `getActivePublicEventReadOnly`, default active event selection and
  `publicQueueEnabled` as request gate.
- `tests/publicEvents.test.ts`: cases that assert Poza Nuta-branded homepage
  positioning or queue visibility as request eligibility.
- `tests/dashboardOrganizationRouting.test.ts`: overlap-publication assertions.
- Relevant parts of `tests/e2e/public.spec.ts`: expectations for current home
  hero copy and single-organizer CTAs.
- Relevant parts of `tests/e2e/dashboard.spec.ts`: expectations that treat the
  current dashboard event lifecycle as final rather than transitional.

### 6. Tests Possible To Preserve

- Public/private/unpublished filtering tests.
- Event slug validation tests for event URLs.
- Sorting tests for live/upcoming/ended after moving phase to `endsAt`.
- Server Component/public route smoke tests.
- Dashboard RBAC tests for owner/manager/operator/viewer boundaries.
- Tests ensuring browser code does not read business tables directly.
- Tests around safe error handling and no secret/token leakage.

## Current To Target Map

**Future recommendation.**

| Current concept | Target concept | Migration stance |
| --- | --- | --- |
| `workspaces` | `organizations` | Bridge/backfill, then rename or replace in later stage. |
| `workspace_members` | `organization_memberships` | Bridge/backfill roles. |
| `operator_users` | `user_profiles` plus role memberships | Preserve link to Supabase user while introducing normal user profile. |
| `platform_members` | platform roles | Keep concept, align naming and constraints. |
| `events.workspaceId` | `events.leadOrganizerOrganizationId` | Add new FK, backfill from workspace, dual-read during transition. |
| `events.venue`, `events.city` | `venues` plus event venue snapshot | Add venue table and snapshot fields before constraining. |
| `events.autoCloseAt` | `events.endsAt` | Add `endsAt`, backfill from `autoCloseAt`, then migrate reads/writes. |
| `events.publicQueueEnabled` | `event_capabilities.liveQueue` | Split from request acceptance. |
| no request capability | `event_capabilities.songRequests` | Add capability before rewriting public requests. |
| `events.isActivePublicEvent` | no target public source of truth | Keep only for legacy paths until retired. |
| single active public event helper | concrete event lookup | Rewrite public request/search/queue APIs. |
| `song_requests.status` current states | target queue states | Expand enum safely in later queue phase. |
| `operator_audit_log` | `audit_logs` | Generalize after target actors/entities exist. |

## Target Data Model Proposal

**Future recommendation.** This is a proposed target model for staged
migrations. It is not itself a migration plan or approval to change the schema.

### `user_profiles`

- Responsibility: local profile for a Supabase Auth user.
- Primary key: `id`.
- Relations: one-to-one with `auth.users.id`.
- Unique constraints: unique `auth_user_id`.
- Indexes: active users, display/search name as needed.
- Historical snapshots: request/performance rows snapshot display name when
  needed.
- Deletion: soft deactivate; do not cascade historical events or performances.

### `public_profiles`

- Responsibility: public presentation page for organizer and/or venue.
- Primary key: `id`.
- Relations: optional one-to-one or typed relation to organization and/or venue.
- Unique constraints: unique `handle_normalized`.
- Indexes: profile status, city/search fields, verified/claimed flags.
- Historical snapshots: event cards may snapshot display name and handle for
  historical consistency.
- Deletion: soft suspend/archive; redirects/handle history may be needed.

### `organizations`

- Responsibility: operational owner/team.
- Primary key: `id`.
- Relations: optional `public_profile_id`.
- Unique constraints: public profile unique when present.
- Indexes: active organizations, status, name search.
- Historical snapshots: event organizer display name and handle.
- Deletion: soft archive; restrict when events or memberships exist.

### `organization_memberships`

- Responsibility: user roles inside organizations.
- Primary key: `id`.
- Relations: `organization_id`, `user_profile_id`.
- Unique constraints: one active membership per organization/user pair.
- Indexes: organization role, user active memberships.
- Historical snapshots: audit logs store actor role context.
- Deletion: soft deactivate; never delete last active owner without replacement.

### `venues`

- Responsibility: physical karaoke locations.
- Primary key: `id`.
- Relations: optional `public_profile_id`.
- Unique constraints: public profile unique when present; possible normalized
  name/address duplicate guard later.
- Indexes: city, geolocation, active/claimed status.
- Historical snapshots: event venue name, address/city snapshot.
- Deletion: soft archive; restrict or detach only with explicit policy.

### `venue_management`

- Responsibility: organization/user management relation for venues.
- Primary key: `id`.
- Relations: `venue_id`, optional `organization_id`, optional `user_profile_id`.
- Unique constraints: prevent duplicate active management assignment.
- Indexes: venue active managers, organization managed venues.
- Historical snapshots: audit logs.
- Deletion: soft deactivate.

### `events`

- Responsibility: public and operational karaoke event.
- Primary key: `id`.
- Relations: `lead_organizer_organization_id`, `venue_id`.
- Unique constraints: public `slug` unique when present.
- Indexes: public catalog by visibility/publishedAt/startsAt/endsAt/city;
  organizer events; venue events.
- Historical snapshots: organizer name/handle, venue name/address/city, event
  title where public history needs stability.
- Deletion: draft can be archived; published events should be soft archived or
  cancelled, not hard deleted.

### `event_organizations`

- Responsibility: lead/co-organizer/partner relations.
- Primary key: `id`.
- Relations: `event_id`, `organization_id`.
- Unique constraints: one relation per event/organization/role; one lead if
  lead is represented here.
- Indexes: event role, organization events.
- Historical snapshots: role display labels if needed.
- Deletion: soft remove or delete before publication; audit after publication.

### `event_staff`

- Responsibility: per-event operator/staff permissions.
- Primary key: `id`.
- Relations: `event_id`, `user_profile_id`.
- Unique constraints: one active staff assignment per event/user/role.
- Indexes: event staff, user assigned events.
- Historical snapshots: audit logs.
- Deletion: soft deactivate.

### `event_capabilities`

- Responsibility: enabled feature modules per event.
- Primary key: `id`.
- Relations: `event_id`.
- Unique constraints: unique `(event_id, capability)`.
- Indexes: capability enabled lookup.
- Historical snapshots: request/performance rows keep enough context to explain
  historical behavior.
- Deletion: soft disable or update config; preserve audit.

### `song_requests`

- Responsibility: requested songs and queue lifecycle.
- Primary key: `id`.
- Relations: `event_id`, `song_id`, optional `user_profile_id`, optional
  `guest_request_session_id`.
- Unique constraints: none globally; possible idempotency key per session later.
- Indexes: event queue by status/position, requester history, song.
- Historical snapshots: singer display name, song title/artist/source snapshot.
- Deletion: keep historical rows; allow redaction of personal data where policy
  requires.

### `guest_request_sessions`

- Responsibility: secure guest continuity for request tracking/cancellation.
- Primary key: `id`.
- Relations: `event_id`, optional linked user profile after claim.
- Unique constraints: unique token hash.
- Indexes: token hash, event/session expiry.
- Historical snapshots: guest display name if needed.
- Deletion: expire/revoke token; preserve request rows. Detailed retention and
  anonymization policy remains open.

### `performances`

- Responsibility: confirmed performances, separate from request creation.
- Primary key: `id`.
- Relations: `event_id`, optional `song_request_id`, optional `user_profile_id`.
- Unique constraints: avoid duplicate performance for same request when linked.
- Indexes: user history, event performances, performedAt.
- Historical snapshots: singer display name and song title/artist.
- Deletion: soft correction/reversal, not silent hard delete.

### `event_attendance`

- Responsibility: check-in and attendance facts.
- Primary key: `id`.
- Relations: `event_id`, optional `user_profile_id`, optional guest session.
- Unique constraints: one active attendance per event/user or event/session.
- Indexes: event attendance, user attendance history.
- Historical snapshots: display name at check-in.
- Deletion: soft remove/redact according to privacy policy.

### `points_ledger`

- Responsibility: immutable point movements.
- Primary key: `id`.
- Relations: `user_profile_id`, `event_id`, optional `performance_id`,
  optional `awarded_by_user_profile_id`, optional `reversed_entry_id`.
- Unique constraints: one award per performance/reason where applicable.
- Indexes: user ledger, event ledger, performance lookup.
- Historical snapshots: reason and amount are immutable; never depend only on
  current totals.
- Deletion: do not delete; reverse with a ledger entry.

### `profile_claims`

- Responsibility: claim requests for public profiles.
- Primary key: `id`.
- Relations: `public_profile_id`, claimant user and/or organization, reviewer.
- Unique constraints: prevent duplicate open claim for same claimant/profile.
- Indexes: status, profile, claimant.
- Historical snapshots: proof metadata and decision reason.
- Deletion: retain audit-safe claim history; redact sensitive proof payloads.

### `publication_reviews`

- Responsibility: moderation for first publication and flagged content.
- Primary key: `id`.
- Relations: subject type/id, requester, reviewer.
- Unique constraints: one open review per subject/purpose.
- Indexes: status, reviewer queue, subject lookup.
- Historical snapshots: submitted values and decision notes.
- Deletion: retain moderation history; redact sensitive details if required.

### `audit_logs`

- Responsibility: security and operational audit trail.
- Primary key: `id`.
- Relations: actor user, organization, event, venue and entity references where
  applicable.
- Unique constraints: optional idempotency key for external callbacks.
- Indexes: actor/time, entity/time, action/time.
- Historical snapshots: sanitized before/after payloads.
- Deletion: retention policy; never store secrets, raw tokens or full cookies.

## Staged Migration Proposal

**Future recommendation.**

### Stage 0: Freeze And Audit

- Commit product model, ADR and current-to-target audit.
- Stop polishing changes that assume one organizer.
- Classify current diff and decide what to salvage.
- No migrations.

### Stage 1: Generic Event Catalog Core

- Neutral homepage and public catalog language.
- Add event access links for request flow so `/session/[code]` resolves a
  concrete event id.
- Introduce `endsAt` beside `autoCloseAt` with backfill.
- Introduce `event_capabilities` for at least `songRequests` and `liveQueue`.
- Keep guest requests without account, but require a valid event access link.
- Remove public request dependency on default active event.

### Stage 2: Public Profiles, Organizations And Venues

- Add `public_profiles`, `organizations`, `organization_memberships`, `venues`
  and `venue_management`.
- Backfill existing workspace as the Poza Nuta organization.
- Add case-preserving handle model.
- Add profile routing rewrite for `/@handle`.
- Add event venue and lead organizer references.

### Stage 3: Public Signup And Moderation

- Public user signup and profile creation.
- Organization onboarding.
- Venue creation/claim flow.
- First-publication moderation.
- Publication reviews and profile claims.

### Stage 4: Queue, Guest Sessions And History

- Expand request statuses.
- Add guest continuity sessions.
- Add event-scoped queue and participant request tracking.
- Add request-to-account claim flow.

### Stage 5: Performances, Points And Notifications

- Add performances.
- Add points ledger.
- Add notifications for upcoming turns.
- Add optional rankings.

## Branch Plan

**Future recommendation.**

- `docs/platform-model-freeze`: only the product model, ADR and audit.
- `feat/platform-event-core`: session-scoped request flow, `endsAt`,
  capabilities and neutral catalog core.
- `feat/public-profiles-venues`: public profiles, organizations, venues and
  `@handle` routing.
- `feat/public-signup-moderation`: public signup, onboarding, claims and
  publication reviews.
- `feat/event-queue-history`: queue states, guest sessions and user history.
- `feat/performances-points`: performances, ledger and optional ranking.

The current branch contains mixed implementation. It should not be committed as
one feature without separating or rewriting the incompatible parts.

## Commit Plan

**Future recommendation.**

1. Commit documentation freeze only.
2. Revert or rewrite incompatible homepage branding and overlap validation.
3. Commit minimal neutral public listing using existing schema only if it does
   not imply the wrong platform model.
4. Commit schema expansion for `endsAt` and capabilities with a Drizzle
   migration, but do not run production migrations without approval.
5. Commit session-scoped public request flow and negative tests.
6. Commit public profile/organization/venue expansion in a separate branch.

## First Safe Implementation Step

**Future recommendation.**

The first safe implementation step after this audit is not UI polishing.

It is to make public request creation session-scoped and event-resolved:

1. public event detail stays informational and does not expose a request form;
2. event access link `/session/[code]` resolves one concrete event id;
3. request form posts through the session-scoped endpoint;
4. backend loads exactly that event from the access link;
5. backend validates public visibility, publication, `songRequests`
   capability, phase and cancellation/closed-early state;
6. tests prove two simultaneous live events can both accept requests
   independently.

This step removes the most dangerous target-model mismatch: global active event
selection.
