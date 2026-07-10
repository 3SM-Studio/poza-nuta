# ADR: Multi-Tenant Karaoke Platform

Status: proposed product architecture, frozen for planning.
Date: 2026-07-10.
Scope: public product model, routing, authorization, event lifecycle and data
ownership. This ADR does not authorize migrations, production changes or data
changes by itself.

Related documents:
- [Product Model](../product/platform-product-model.md)
- [Current To Target Model Audit](./current-to-target-model-audit.md)

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
requests.

Guest request sessions must use a secure server-controlled mechanism, such as
HttpOnly cookies or signed claim links. Do not store participant tokens in
`localStorage` or `sessionStorage`.

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
- Public request routes must be rewritten to accept and validate `eventId`.
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
- Public request endpoints must validate event id, visibility, publication,
  phase, cancellation state and capability.
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
- guest request without session;
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
- Data retention and anonymization policy.
- Detailed moderation SLA and appeal process.
