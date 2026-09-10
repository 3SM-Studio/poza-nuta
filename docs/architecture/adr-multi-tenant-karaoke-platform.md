# ADR: Multi-Tenant Karaoke Platform

Status: proposed product architecture, frozen for planning.
Date: 2026-07-10.
Scope: public product model, routing, authorization, event lifecycle and data
ownership. This ADR does not authorize migrations, production changes or data
changes by itself.

Related documents:
- [Product Model](../product/platform-product-model.md)
- [Current To Target Model Audit](./current-to-target-model-audit.md)
- [Platform Admin Dashboard Contract](../features/platform-admin-dashboard.md)

Decision labels:
- **Accepted decision**: binding architecture decision for the rebuild.
- **Future recommendation**: preferred implementation direction that still needs
  detailed design.
- **Open decision**: unresolved product, policy or technical detail.

## Context

Poza Nuta started as an application for one karaoke organizer with one default
workspace, one active public event and a public request flow that could find the
current event globally.

The product direction is now a nationwide karaoke platform:

- people discover karaoke events in Poland;
- organizers and venues can have public profiles;
- many organizations can publish events;
- many events can be live at the same time;
- song requests are optional per event;
- guest song requests remain possible without an account;
- queue, check-in, history and points are event capabilities, not assumptions
  baked into every event.

The old model remains useful as an implementation starting point, but it must
not define the target architecture.

## Decision

The subsections in this section are **accepted decisions** unless explicitly
marked otherwise.

### One Account, Many Roles

There is one technical user account.

Do not introduce separate account types such as:

- user;
- organizer;
- venue owner;
- operator.

Supabase Auth proves identity. Local application tables decide permissions.

A person can be a participant, organization owner, venue manager and event
operator at the same time. The role depends on the membership or assignment
being evaluated.

### Platform Administration Is A Separate Authorization Boundary

The platform administration surface uses `/admin`. Organization administration
remains under `/dashboard/org/[organizationId]`. An organization role does not
grant platform access and a platform role does not implicitly become an
organization membership.

An `/admin` request must resolve, server-side, all of the following:

1. a valid Supabase Auth user;
2. an active linked local operator record;
3. an active `platform_members` record;
4. the permission required for the requested read or mutation.

Client-supplied platform roles are never trusted. Browser code does not read
`platform_members`, `workspace_members`, `import_jobs` or audit tables directly.
Protected data is returned through server-side services and thin App Router
adapters.

Platform roles are:

- `platform_owner`: full platform access, platform-role management, imports,
  audit and critical settings;
- `platform_admin`: application suspension of ordinary users, imports and
  read-only operational oversight of users and organizations, without authority
  to mutate any `platform_members` role or owner-only critical setting;
- `support`: read-only operational access, including safe import errors, with
  no import execution or platform-role mutation.

Only `platform_owner` may grant, change, deactivate or remove any platform role,
including `platform_owner`, `platform_admin` and `support`. `platform_admin`
performs no mutations of `platform_members`.

An eligible platform owner is a user who simultaneously has an active local
application profile, is not suspended, and has an active `platform_members`
membership with role `platform_owner`.

Multiple eligible platform owners are allowed. Every path that can delete,
deactivate, demote or suspend an owner must preserve at least one eligible
platform owner, including under concurrent requests. The transition must
remove the current database uniqueness rule that permits only one active owner
and replace it with durable last-owner protection. Bootstrap logic must treat
one or more eligible owners as initialized. The exact locking/database
mechanism is deferred to migration discovery and review.

Suspension is an application authorization state, not deletion or direct
blocking of the Supabase Auth identity. It requires a reason and audit record,
preserves identity, memberships and history, and unlock restores application
access. Self-suspension is forbidden. `platform_admin` cannot suspend a
`platform_owner`; an owner may suspend another owner only when the last-owner
invariant preserves another eligible platform owner. The implementation
representation is intentionally not selected in this ADR.

Organization owners can invite, remove and change members only inside their own
organization. They cannot grant platform roles. The first `/admin/organizations`
module is read-only; future platform cross-organization mutations require a
separate product decision and specification.

### Imports Are Durable Jobs

iSing and KaraFun imports must run as durable background jobs rather than as
long-running HTTP requests. The UI creates a job and observes its state through
server-side APIs. Jobs are idempotent, use song upserts and never truncate or
destructively replace the catalog. At most one job for a source may be active at
the same time.

Minimum target states are `queued`, `running`, `succeeded`, `failed` and
`cancelled`. Jobs record source, initiating operator, timestamps, progress,
counters and a sanitized error summary. Import secrets and service credentials
remain server-side. Job creation, cancellation and completion are audit events.

The exact worker and queue technology is intentionally not selected by this
ADR. A follow-up ADR must compare a Postgres-backed job table with a dedicated
worker, a managed queue/workflow service and a Supabase-hosted worker option
against Vercel execution limits, retry semantics, cancellation, observability,
cost and private CSV storage. A request-lifetime callback is not sufficient as
the sole durability mechanism for a full catalog import.

Audit records are retained for 365 days from creation. Import job metadata is
retained for 365 days from terminal state. Safe diagnostic details are retained
for 30 days from recording. KaraFun source files stay in private storage for no
more than 7 days from upload, regardless of job state, and may be removed
earlier after diagnostics. A never-terminal job requires stale-job recovery and
a maximum retention rule in the worker/cleanup ADR. Cleanup cannot extend a
period by rewriting its anchor timestamp. These timestamp names are semantic,
not preselected columns.

File deletion preserves job metadata, counters and an anonymized, sanitized
summary. Cleanup must be observable and audited. Audit export is outside the
first MVP. The storage provider and cleanup scheduler require separate technical
analysis. Secrets, tokens, credentials and raw sensitive errors are never
durable audit or logging payloads.

Every new administrative mutation uses a shared server-side audit writer. The
implementation first discovers existing `operator_audit_log` usage and then
chooses a compatible table extension or platform audit layer. Audit semantics
cover actor, action, target type/id, outcome, safe reason/summary and timestamps;
payload sanitization excludes secrets, tokens, cookies, complete Auth payloads
and raw errors.

These administrative periods are accepted and closed. Detailed retention and
anonymization for other domains, including participants, events, profiles,
requests and performance history, remain an open product decision.

### Organization And Venue Are Separate

An organization is an operational owner: a team, company, foundation or group of
organizers.

A venue is a physical place: address, city, coordinates and local presentation.

An organization can manage multiple venues. A venue can have one or more
management relationships. A venue is not automatically the same thing as the
organization that manages it.

### Public Profile Is A Presentation Layer

`public_profiles` is the shared public presentation layer for organizers and
venues.

A public profile can represent:

- an organization;
- a venue;
- a combined venue/organizer presentation when that is a product choice.

Public profile does not replace the operational organization or physical venue
tables.

### Handles Are Case-Preserving

Public handles use:

- `handle`: canonical case-preserving value, for example `PozaNuta`;
- `handleNormalized`: case-insensitive unique value, for example `pozanuta`.

Canonical public URLs look like:

- `/@PozaNuta`;
- `/@iGranieWLochu`;
- `/@KaraokeGdansk`.

Requests with non-canonical casing redirect to the canonical URL.

Ordinary user profiles do not receive public `@handle` pages in the MVP.

Do not create `src/app/@[handle]`, because `@` has special meaning in Next.js
App Router parallel routes. Implement public profile routing through a root
dynamic segment or a rewrite to an internal route such as
`/profiles/[handle]`.

### Event Requests Always Target Event Id

Every public song request must point to a concrete `eventId`.

The backend must not select the event by:

- a default workspace;
- one global active public event;
- `isActivePublicEvent`;
- the first event matching a time window.

Request validation must load the exact event and then verify publication,
visibility, capability, phase and cancellation state.

### No Global Active Event

The platform can have many live events at the same time. There must be no global
single active event invariant in the public platform model.

There must be no global block on overlapping event time windows. Any future
overlap rule would have to be local, explicit and justified by a specific
business policy.

Existing `status = active`, `isActivePublicEvent` and
`events_one_active_public_per_workspace_idx` are legacy/current-app mechanisms.
They can remain during transition, but they must not become the source of truth
for nationwide public discovery or request acceptance.

### Public Phase Comes From Time

Target event phase is computed from time:

- `upcoming`: `referenceNow < startsAt`;
- `live`: `startsAt <= referenceNow < endsAt`;
- `ended`: `referenceNow >= endsAt`.

Additional domain states are explicit:

- cancelled;
- postponed;
- closed early.

`startsAt` and `endsAt` are required in the target event model. Cancelled and
closed-early events cannot accept new public requests.

Publication does not start an event. No cron is required to flip public phase.
Any read or mutation that depends on phase must compute it from the current
event data.

### Event Capabilities Are Optional

Events can enable independent capabilities:

- listing;
- songRequests;
- liveQueue;
- checkIn;
- points.

Publishing an event must not require using the platform queue.

`songRequests` controls whether public requests can be accepted.
`liveQueue` controls whether the public queue feature is available.
Those concepts must not be collapsed into one boolean.

### Guest Requests Remain Allowed

An account is never required for normal public song requests. This applies to
every public request when the event allows guest requests, not only to a first
request.

The backend can optionally link a request to a user profile when a valid session
exists, but the public guest flow remains available when the event allows song
requests. The Stage 1 guest flow starts from an event access link
`/session/[code]`; `/events/[slug]` remains informational and does not grant
request permission.

Future guest continuity sessions, used for tracking a guest's own requests,
cancellation and later account claim, must use a secure server-controlled
mechanism, such as HttpOnly cookies or signed claim links. Do not store
participant tokens in `localStorage` or `sessionStorage`. These future
continuity sessions are distinct from organizer-issued event access links.

### First Publication Requires Moderation

First public publication by a new organizer is subject to moderation. The exact
verification workflow, evidence requirements and SLA are open decisions.

### Points Are Later

Points are outside Stage 1. The target points model awards points for confirmed
performances, not for request creation.

## Consequences

- `workspaces` can be treated as the current implementation of organizations,
  but the target model needs explicit `organizations`.
- `operator_users` is a current local operator profile. The target model needs
  `user_profiles` connected to Supabase Auth, with operator permissions derived
  from memberships and event staff assignments.
- `workspace_members` maps to organization memberships during transition.
- Text `events.venue` and `events.city` are insufficient for the target venue
  model; event pages need `venueId` and historical venue snapshots where needed.
- Public request routes must be scoped by an event access link or another
  concrete event reference; a public slug alone must not create a request.
- Public event listing and detail can reuse catalog concepts, but must not rely
  on default workspace selection.
- Queue endpoints must be scoped to event id or session code, never to a global
  active event.
- Existing tests that protect the single-organizer request flow must be replaced
  by tests protecting concrete event selection.
- Future migrations must use safe expand/backfill/verify/constrain sequencing.

## Alternatives Considered

### Keep Workspaces As The Final Organization Model

Rejected as a final model. Workspaces are useful during transition, but they
currently carry kebab-case handles, single-active-event assumptions and no clean
separation between organization, venue and public profile.

### Add Technical Account Types

Rejected. A single human may act in multiple roles. Separate account types would
create duplication and role escalation risks.

### Keep One Active Public Event

Rejected. A nationwide platform must allow many organizations and many venues to
run events simultaneously.

### Use Kebab-Case For Public `@handle`

Rejected. Public profile handles should preserve brand casing and remain unique
case-insensitively.

### Treat Public Queue Visibility As Request Eligibility

Rejected. Request acceptance and queue visibility are separate event
capabilities.

## Security Requirements

**Accepted decision.**

- Never trust client-supplied role, organization id, venue id or event
  permission.
- All protected reads and writes must enforce server-side authorization.
- Public request endpoints must resolve a concrete event from an event access
  link or another explicit event reference, then validate visibility,
  publication, phase, cancellation state and capability.
- Public endpoints need rate limiting before broad public launch.
- Public contracts must not expose internal workspace ids, operator ids, access
  link hashes, guest tokens or private notes.
- Moderation and profile claim flows require audit logs.

## Migration Guidance

**Future recommendation.**

Do not replace the current model in one destructive migration.

Use an expand/backfill/verify/constrain approach:

1. Add new tables and nullable references.
2. Backfill from existing workspaces, events and operator users.
3. Dual-read or feature-flag new reads where needed.
4. Move writes to the new model.
5. Verify counts, ownership and request routing.
6. Add required constraints only after data is consistent.
7. Retire legacy fields in a later migration.

## Testing Requirements

**Future recommendation.**

Minimum tests for implementation stages:

- concrete `eventId` request acceptance and rejection;
- private/unpublished/cancelled/ended event rejection;
- guest request without user account but with a valid event access link;
- logged-in request optionally linked to user profile;
- multiple simultaneous live events;
- capability separation between `songRequests` and `liveQueue`;
- public profile handle canonical redirects;
- organization and venue authorization boundaries;
- negative tests for role escalation and cross-organization access.

## Open Decisions

- Monetization model.
- Detailed organizer verification process.
- Detailed profile claim process.
- Guest request cancellation policy.
- Notification channels and consent model.
- Future ranking rules.
- Exact guest-performance-to-account claim mechanism.
- Detailed retention and anonymization for participants, events, profiles,
  requests and performance history. Administrative retention is closed.
- Detailed moderation SLA and appeal process.
