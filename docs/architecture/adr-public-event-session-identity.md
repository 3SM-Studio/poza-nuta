# ADR: Public event and session identity

## Status

Accepted for migration 0021 (expand). Migration 0022 is intentionally deferred.

## Context

The original public session contract used `events.session_code` both as a
human-entered code and as the identity embedded in links and QR codes. Dashboard
event routes also exposed the internal bigint event key. Rotating a code would
therefore have broken every printed QR code, while a public route based on the
database key would have coupled external identity to storage.

The event lifecycle already owns availability. Closing an event does not delete
or terminalize its queue or requests, so the same event can be reopened safely
without reconstructing data.

## Decision

### Event and session identity

Every event has exactly one `event_sessions` row. The row has no business
status. Draft, scheduled, active, closed-reopenable, and closed-finalized are
derived from the event lifecycle.

`events.id` remains the internal bigint primary key and all existing foreign
keys continue to reference it. `events.public_id` is a stable UUID used by new
dashboard routes. UUID knowledge never replaces authentication, organization
membership, or server-side RBAC.

Each session receives an immutable public token generated from exactly 16
CSPRNG bytes and encoded as unpadded Base64URL. The result is 22 characters and
provides 128 bits of entropy. `/s/{publicToken}` is the canonical public session
route and is marked `noindex`.

The eight-digit code is only a manual entry alias. `/join` is used because the
user is joining an event session; `/invite` remains reserved for future operator
and organization invitations. `/join/{code}` resolves an active assignment and
returns a temporary, non-cacheable redirect to `/s/{publicToken}`.

QR codes encode only `/s/{publicToken}`. A code rotation therefore leaves the
canonical URL, downloaded SVG, and printed QR unchanged.

### Code history and rotation

`event_session_codes` stores every assignment. Rotation locks the event and
session, revokes the current assignment, creates a new CSPRNG code, dual-writes
`events.session_code`, and records `event.session_code.rotate` atomically. Audit
payloads never include either code or public token.

Migration 0021 keeps codes globally unique across all history. Revoked codes
receive `release_after` at least 365 days after revocation, but no recycling is
enabled. This deliberately preserves the existing unique
`events.session_code` contract.

A later reviewed contract migration 0022 may remove the historical global
uniqueness constraint, prove that quarantine has expired, add a safe allocator,
and eventually retire the legacy dual-write. It must not recycle public tokens.

### Lifecycle operations

The reopen grace period is exactly 20 minutes and uses the strict condition
`now < closedAt + 20 minutes`. Reopen is allowed at 19:59 and denied at exactly
20:00 and at 20:01. Manual closure uses its transaction timestamp. Automatic
closure uses the scheduled close instant as its authoritative boundary.

Reopen requires a new future close time (+20, +30, +60 minutes, or a validated
custom instant). Extend uses the same choices for an active event. Both
operations lock and recheck the event and actor, preserve session identity and
queue data, and write atomic audit rows (`event.reopen` or `event.extend`).

Close reasons are constrained to `manual`, `scheduled`, and `automatic`.

### Compatibility

`/session` permanently redirects to `/join`. `/session/{code}` remains a thin,
temporary, non-cacheable code resolver. Existing code-based API handlers remain
thin adapters over the same service used by token-based APIs.

Numeric dashboard event paths are accepted temporarily. The server authenticates
the operator and scopes the lookup to the organization before redirecting to the
UUID route. New links and actions emit only the public UUID.

Public queue Realtime keeps the existing broadcast mechanism but addresses the
public topic by immutable session token rather than exposing the internal event
ID. Dashboard topics continue to use the internal event ID server-side.

## Security consequences

- Codes, UUIDs, and public tokens are identifiers, not operator authorization.
- New tables use RLS with no browser policies or direct browser grants.
- Token and code generation use bounded retries and map uniqueness failures to
  safe domain outcomes.
- Public responses do not expose the internal event ID.
- Codes and tokens are excluded from audit payloads, diagnostics, and business
  logs. URL access logs may naturally contain the public token.
- Inactive, revoked, finalized, and unknown codes produce the same neutral user
  state and reveal no organization or event details.

## Alternatives rejected

- Keeping the short code in QR payloads: rotation would invalidate printed QR
  material.
- Using bigint IDs publicly: this leaks storage identity and couples routes to
  persistence.
- Using UUID alone for the public session URL: UUID is appropriate for dashboard
  routing, but the independent 128-bit token gives the session its own stable
  identity.
- Giving sessions a separate status: this would create a second lifecycle and
  allow event/session state drift.
- Immediate code recycling: safe reuse requires quarantine enforcement and a
  reviewed contract migration, so it is deferred to 0022.

## Consequences

Migration and code must be released in expand order. Until 0022, every event
write dual-writes the legacy code column and the current code assignment. All
production event creation paths must create the event, session, token, and
initial code assignment in one transaction.
