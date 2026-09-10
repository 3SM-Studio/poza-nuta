# Poza Nutą - Organization Routing

Date: 2026-07-05

## Scope

This document describes the current dashboard organization routing layer.
Organization means `workspace`.

The route segment is named `organizationId`:

```txt
/dashboard/org/[organizationId]
```

`organizationId` maps to `workspaces.public_id`. It does not map to
`workspaces.handle`, and there is no legacy fallback from handle to public ID.
`workspaces.id` is not used in public/dashboard URLs because it is an internal
sequential database ID.

`/dashboard/org/pozanuta` is not supported unless `pozanuta` is the actual
`workspaces.public_id`. The current public ID format requires 20 lowercase
alphanumeric characters, so the default handle `pozanuta` is not a valid
organization URL ID.

Implemented routes:

- `/dashboard/organizations`
- `/dashboard/org/[organizationId]`
- `/dashboard/org/[organizationId]/settings`
- `/dashboard/org/[organizationId]/settings/general`
- `/dashboard/org/[organizationId]/events`
- `/dashboard/org/[organizationId]/team`
- `/dashboard/organizations/new`
- `/dashboard/account/me`

Compatibility routes remain available:

- `/dashboard`
- `/dashboard/queue`
- `/dashboard/settings`

## Authorization Model

Dashboard authentication still starts with Supabase Auth and the local operator
mapping:

1. Supabase Auth user ID.
2. `operator_users.auth_user_id`.
3. Active local `operator_users` row.
4. Active `workspace_members` row.
5. Active `workspaces` row matching `organizationId` to
   `workspaces.public_id`.

Every `/dashboard/org/[organizationId]/*` page must check membership for the
current Supabase Auth user. A logged-in user without a matching active
membership must not see the organization page.

The current implementation returns a 404-style response through Next.js
`notFound()` when the workspace membership check fails. This avoids exposing
whether an organization/workspace identifier exists.

## Settings And Team MVP

`/dashboard/org/[organizationId]/settings` is the canonical organization
settings page. It shows the organization name and read-only
`workspaces.public_id`, lets an owner update the organization name, and lets an
owner archive the organization.

`/dashboard/org/[organizationId]/settings/general` is kept only as a redirect to
`/dashboard/org/[organizationId]/settings`.

Organization archive is a soft delete:

- it sets `workspaces.active=false`,
- it does not hard-delete the workspace,
- it does not delete events,
- it does not delete requests,
- it does not delete memberships.

`/dashboard/org/[organizationId]/team` is a read-only MVP. It lists local
workspace members with available local operator data, role, and active state.
It does not invite members, change roles, call Supabase service-role APIs, or
look up Auth users outside the current local schema.

## Current Limits

- Event listing is read-only.
- Organization creation is limited to a minimal owner bootstrap form.
- There is no organization-scoped queue route in this stage.
- There is no Google account linking in this stage.
- There is no writable member management UI in this stage.
- Existing `/dashboard/*` shortcuts still use the default workspace behavior.

## Data Requirement

The schema supports organization access through `workspace_members`, but the
existing bootstrap scripts do not automatically create membership rows for
previously linked operators. Before demo, verify that the intended operator has
an active `workspace_members` row for the `pozanuta` workspace or any workspace
being tested.

New organizations created through `/dashboard/organizations/new` automatically:

- generate `workspaces.public_id`,
- generate a technical `workspaces.handle` from the name,
- create an active `workspace_members` row,
- assign the current operator the `owner` role.

## Linking A Workspace Member

Use `pnpm db:link-workspace-member` when a Supabase Auth user is already linked
to an active `operator_users` row, but that operator does not yet have an active
`workspace_members` row for the dashboard workspace.

Required ENV:

- `DIRECT_URL`
- `OPERATOR_AUTH_USER_ID`

Optional ENV:

- `WORKSPACE_HANDLE`, default `pozanuta`
- `WORKSPACE_MEMBER_ROLE`, default `owner`

Recommended bootstrap order:

1. `pnpm db:migrate`
2. `pnpm db:seed`
3. `pnpm db:seed:operator`
4. `pnpm db:link:operator-auth`
5. `pnpm db:link-workspace-member`

The script is idempotent. If the membership already exists and is active, it
does not create a duplicate. If the membership exists but is inactive, it sets
`active=true`. It does not print `DIRECT_URL`, `OPERATOR_AUTH_USER_ID`, or
tokens.

## Public Queue Realtime Status

The global public `/queue` page has been removed, and `/api/public/queue` remains
only as a legacy 410 endpoint. Participant queue access is session-scoped under
`/session/[code]` and uses Realtime only as an invalidation signal before
refetching through the session API. Do not expose the private dashboard channel
publicly.
