# Poza Nutą Platform Product Model

Status: frozen product direction for the multi-tenant karaoke platform.
Date: 2026-07-10.
Scope: product and domain model. This document does not authorize migrations,
data changes, production changes, or implementation changes by itself.

Related documents:
- [ADR: Multi-Tenant Karaoke Platform](../architecture/adr-multi-tenant-karaoke-platform.md)
- [Current To Target Model Audit](../architecture/current-to-target-model-audit.md)

Decision labels:
- **Accepted decision**: binding product rule for the platform rebuild.
- **Future recommendation**: preferred direction that still needs detailed
  implementation design.
- **Open decision**: unresolved product or policy choice. Open decisions do not
  block Stage 1 unless explicitly marked as blockers.

## Product Definition

**Accepted decision.**

Poza Nutą is a nationwide karaoke platform for discovering, publishing and
operating karaoke events in Poland.

The platform supports, or is intended to support:

- searching karaoke events;
- browsing organizers and venues;
- publishing karaoke events;
- optionally accepting song requests;
- operating a live karaoke queue;
- keeping performance history;
- later awarding points for confirmed performances.

Poza Nutą is not only a website for events organized by the Poza Nutą team.
`@PozaNuta` is one organizer on the platform, governed by the same public model
as other organizers and venues.

The homepage should be a neutral karaoke discovery experience. The primary
message is:

> Znajdź karaoke blisko siebie

The supporting copy is:

> Odkrywaj wydarzenia karaoke w całej Polsce, sprawdzaj lokale i organizatorów
> oraz zgłaszaj swoje piosenki.

Avoid positioning the homepage as "our events", "Poza Nutą events", or "invite
Poza Nutą to your venue" as the primary platform story.

## Personas

**Accepted decision.**

Guest participant:
- does not need an account;
- can find events;
- can submit a song request when an event allows guest requests;
- can track their request through a guest-safe session mechanism.

Registered participant:
- has one platform account;
- can keep request and performance history;
- can save events;
- can receive notifications;
- can later claim a guest performance through a secure code or link.

Organizer member:
- has the same account type as every other user;
- belongs to one or more organizations;
- receives permissions through organization memberships and event staff roles.

Venue manager:
- has the same account type as every other user;
- can manage one or more physical venues through venue management membership;
- may also belong to organizations.

Event operator:
- is assigned to a specific event;
- may manage queue, check-in, or reports depending on event staff role;
- does not automatically gain organization administration rights.

Platform moderator:
- reviews suspicious or first-time publication activity;
- handles unclaimed profiles, claims, duplicates, suspensions and reports.

## Core User Journeys

**Accepted decision for the target experience.** Details marked as moderation,
notification, claiming or points remain future recommendations or open
decisions in the later sections.

Find karaoke:
1. User lands on `/`.
2. User searches or browses by place, date, organizer, venue, or map.
3. User opens an event detail page.
4. User views organizer, venue and event capabilities.

Submit a guest song request:
1. Guest opens an event access link at `/session/[code]` from the organizer's QR
   code or shared session code.
2. The session code resolves exactly one concrete event id on the backend.
3. Guest fills required participant data, such as pseudonym.
4. Backend validates event visibility, publication, phase, capability and
   cancellation state.
5. Request is stored against the exact event id.

Submit as a logged-in user:
1. User opens the same `/session/[code]` event access flow.
2. Backend still accepts the request by event id.
3. If a valid user session exists, request may be linked to user profile.
4. Account gives history and later points features, but is not required.

`/events/[slug]` is the public informational catalog page for an event. The
public slug does not grant request permission and must not create song requests.

Publish an event:
1. Authorized organization or event manager creates a draft.
2. Draft can exist without a public listing.
3. Publication requires required public fields and configured capabilities.
4. First public publication by a new organizer is subject to moderation.
5. Publication does not mean the event has started.

Operate a queue:
1. Event must have the relevant capabilities enabled.
2. Staff role controls who can operate the queue.
3. Requests move through queue states.
4. Performance is confirmed separately from request creation.

Claim a public profile:
Future recommendation; the exact claim process is an open decision.

1. A public organizer or venue profile may exist as unclaimed.
2. A verified user starts a claim.
3. Moderator or automated proof verifies ownership.
4. Profile transitions to claimed or verified.

## Accounts And Roles

**Accepted decision.**

There is one technical account model.

Do not create separate technical account types such as:
- user;
- organizer;
- venue owner.

A single person can simultaneously:
- participate in karaoke;
- belong to one or more organizations;
- manage a venue;
- operate a specific event;
- own an organization.

Authorization comes from memberships and roles:
- platform roles;
- organization roles;
- venue management roles;
- event staff roles.

Account identity is provided by Supabase Auth. Business permissions are decided
by local application records. Do not trust client-supplied roles or profile
claims.

## Organizations

**Accepted decision.**

An organization represents a team, company, foundation, group of organizers, or
other operational owner.

Organization responsibilities:
- own operational responsibility for events;
- manage members and roles;
- optionally manage one or more venues;
- publish public profiles or events.

Example organization roles:
- owner;
- admin;
- event_manager;
- member;
- viewer.

Organization membership does not automatically grant full permissions on every
event relationship such as venue, co-organizer or partner.

## Venues

**Accepted decision.**

A venue is a physical place.

Venue responsibilities:
- name and public presentation;
- address and geolocation;
- local contact and accessibility details;
- relation to managing organizations;
- relation to events happening there.

One organization may manage many venues. A venue may have a public profile and
may also be represented by an organization. Organization and venue remain
separate domain entities.

## Public Profiles And `@handle`

**Accepted decision.**

Public profile is the presentation layer for an organizer, a venue, or both.

Canonical public URLs preserve owner-selected handle casing:
- `/@PozaNuta`;
- `/@iGranieWLochu`;
- `/@KaraokeGdansk`.

Handle model:
- `handle`: case-preserving display/canonical value, e.g. `iGranieWLochu`;
- `handleNormalized`: case-insensitive unique value, e.g. `igraniewlochu`.

Requests to non-canonical casing should redirect to the canonical URL:
- `/@igraniewlochu` -> `/@iGranieWLochu`;
- `/@IGRANIEWLOCHU` -> `/@iGranieWLochu`.

Do not require kebab-case for public profile handles.

Do not create a Next.js App Router folder named `app/@[handle]`, because `@`
has a reserved meaning for Parallel Routes. Prefer a root dynamic segment or a
rewrite that routes `^/@([^/]+)` to an internal profile route.

In the MVP, ordinary user profiles do not need public `@handle` pages.

## Events

**Accepted decision.**

An event has:
- stable id;
- public slug;
- lead organizer organization id;
- venue id;
- optional co-organizers;
- optional partners;
- assigned staff/operators;
- `startsAt`;
- `endsAt`;
- visibility;
- `publishedAt`;
- cancellation or postponement state;
- optional capabilities.

`startsAt` and `endsAt` are required in the target model. `autoCloseAt` is an
implementation-era name and should be replaced by `endsAt` or mapped carefully
during migration.

One organization is the lead operational owner of an event. Venue, co-organizer
and partner relationships do not automatically grant full admin rights.

Example event staff roles:
- event_manager;
- queue_operator;
- check_in_operator;
- report_viewer.

## Event Capabilities

**Accepted decision.**

Not every event uses every platform module.

Target capabilities:
- listing;
- songRequests;
- liveQueue;
- checkIn;
- points.

Examples:
- listing only;
- listing plus song requests;
- listing plus song requests plus queue;
- full system with check-in, performances and points.

Publishing an event must not require using the platform queue.

`songRequests` and `liveQueue` are separate capabilities. `songRequests`
controls whether the event can accept song requests. `liveQueue` controls
whether the event exposes a queue feature.

## Guest And User Song Requests

**Accepted decision.**

An account is never required to submit a song request. This applies to every
request, not only the first one.

Guest request is allowed when the event:
- is public;
- is published;
- is currently live;
- has `songRequests` capability enabled;
- is not cancelled, postponed away from current time, or closed early.

The backend must not require a session user for normal public requests.
It must require a valid event access link at `/session/[code]`; the code, not a
public slug, grants access to the event features.

Every request must point to a concrete `eventId`. The backend must not globally
search for one active event.

Logged-in users may link a request to their user profile. Guest continuity is a
separate future session/token model for tracking a guest's own requests,
cancellation and later account claim. It is not the same thing as the event
access link that unlocks `/session/[code]`.

## Queue

**Future recommendation.**

Target request states:
- pending;
- accepted;
- queued;
- called;
- performed;
- cancelled;
- no_show;
- rejected.

Participants should be able to:
- see their own request status;
- cancel a request when the future guest-cancellation policy allows it;
- see approximate queue position;
- receive a notification that their turn is approaching.

Do not promise exact performance time without a reliable estimation model.

## Lifecycle

**Accepted decision.**

Public phase is computed from time:

- upcoming: `referenceNow < startsAt`;
- live: `startsAt <= referenceNow < endsAt`;
- ended: `referenceNow >= endsAt`.

Additional domain states:
- cancelled;
- postponed;
- closedEarly.

Cancelled or closed-early events cannot accept new song requests.

Publication does not mean start. No cron is needed to change phase. Phase is
computed at read time and during every operation that depends on time.

Legacy `status = active` and `isActivePublicEvent` must not be sources of truth
for the new multi-event public catalog.

## Moderation

**Accepted decision, with open operational details.**

The platform must support:
- unclaimed profiles;
- claimed profiles;
- verified profiles;
- suspended profiles;
- profile claiming;
- duplicate reports;
- profile merges;
- incorrect event reports;
- moderation of first publication for new organizers.

Any verified user may eventually create an organization, venue and event draft.
First public publication by a new organizer requires moderation. The detailed
verification process, approval criteria and SLA are open decisions.

## Points

**Future recommendation.**

Points are not part of the first MVP stage.

Points are awarded for confirmed performance, not for request creation.

Operator marks a request or performance as performed. Points should be stored in
a ledger, not only in a `total` field.

Target `points_ledger` fields:
- userId;
- eventId;
- performanceId;
- amount;
- reason;
- awardedByUserId;
- createdAt;
- reversedEntryId.

Guest performances may later be attached to an account through a secure code or
link. The exact claim mechanism is an open decision.

## Privacy Rules

**Accepted decision, with open retention details.**

Public event pages must not expose:
- operator internal ids;
- workspace ids;
- access link hashes;
- guest session tokens;
- private notes;
- unpublished/private events.

Future guest continuity/session tokens must not be stored in localStorage or
sessionStorage. Event access links for `/session/[code]` are separate
organizer-issued access codes that resolve the event.
Prefer HttpOnly cookies or short-lived signed claim links.

Participant personal data must be scoped to event operations and should be
minimized in public queue views.

Detailed data retention and anonymization policy is an open decision.

## Cancellation And Postponement

**Future recommendation.**

Cancelled event:
- remains historically visible when public policy allows it;
- cannot accept new requests;
- should show a clear public message.

Postponed event:
- keeps the original historical value if needed for audit;
- receives new `startsAt` and `endsAt`;
- may notify saved participants.

Closed early event:
- has a `closedEarlyAt` or equivalent state;
- phase is ended for request acceptance;
- historical queue and request records remain intact.

## Assumptions Frozen By This Document

**Accepted decision.**

- Poza Nutą is a nationwide platform, not a single-organizer website.
- `@PozaNuta` is one organizer profile.
- One account can hold many roles.
- Guest song requests remain allowed.
- Public request creation must use a valid `/session/[code]` event access link
  that resolves a concrete event id.
- Event capabilities are optional.
- Multiple events can be live at the same time.
- No global active public event should exist in the target model.
- `startsAt` and `endsAt` define public phase.
- Public profile handles are case-preserving and case-insensitive unique.

## Open Product Decisions

- Monetization model.
- Detailed organizer verification process.
- Detailed public profile claim process.
- Guest request cancellation policy.
- Exact moderation rules for first organizer publication.
- Whether public profile claim proof is manual, automated, or hybrid.
- How guest request session links are delivered and recovered.
- Which event capabilities are part of Stage 1 versus Stage 2.
- Whether venues can be created as unclaimed records by any verified user.
- Public visibility of ended/cancelled events.
- Notification channels and notification consent model.
- Ranking and points display policy.
- Exact mechanism for assigning a guest performance to a user account.
- Data retention and anonymization policy.
