# Poza Nuta — Codex Instructions

## Currently implemented product

Poza Nuta is a karaoke queue application for local events.

Public users can:
- search songs,
- submit song requests,
- view the public queue when enabled.

Dashboard users can:
- sign in with Supabase Auth,
- manage the active event,
- manage the queue.

## Target product

Planned capabilities, not necessarily implemented yet:
- event listings and shareable event/session routes,
- QR-based participant sessions and nicknames,
- co-singers and participant history,
- manage participants,
- manage catalog imports,
- manage members/owners.

## Architecture

- Next.js App Router.
- Active application routes live in `src/app`.
- Shared UI, server logic, database code, and helpers live in
  `src/components`, `src/server`, `src/db`, and `src/lib`.
- Next.js proxy lives in `src/proxy.ts`.
- Vercel-compatible runtime.
- Supabase Postgres.
- Drizzle ORM for server-side database access.
- Supabase Auth only for dashboard identity/session.
- Business operations must go through server-side API routes.
- Do not use browser Supabase client for direct business table access.
- Public users do not use Supabase Auth.
- Target participant sessions should use HttpOnly cookies and hashed tokens in the database.

## Currently implemented routes

Public:
- `/` — public song search and request form.
- `/queue` — public queue.

Dashboard:
- `/sign-in`
- `/dashboard`
- `/dashboard/queue`
- `/dashboard/settings`

API:
- `/api/health`
- `/api/public/event`
- `/api/public/songs/search`
- `/api/public/requests`
- `/api/public/queue`
- `/api/dashboard/login`
- `/api/dashboard/logout`
- `/api/dashboard/me`
- `/api/dashboard/event`
- `/api/dashboard/event/start`
- `/api/dashboard/event/extend`
- `/api/dashboard/event/close`
- `/api/dashboard/queue`
- `/api/dashboard/requests/[requestId]/{approve,reject,start,done,skip}`

Legacy compatibility:
- `/operator/login`
- `/operator/queue`
- `/api/operator/*`
- Do not add new operator routes.

## Target routes

These are product direction, not claims about current implementation:

Public:
- `/events/[slug]`
- `/session/[code]`

Dashboard:
- `/setup`
- `/dashboard/events`
- `/dashboard/participants`
- `/dashboard/imports`
- `/dashboard/members`

API:
- `/api/session/*`

## Security rules

- Never expose service_role or secret keys in browser code.
- Never put secrets in NEXT_PUBLIC variables.
- Do not modify `.env`.
- `.env.example` may contain placeholders only.
- Do not use localStorage/sessionStorage for auth/session tokens.
- Dashboard access requires Supabase Auth session plus an active local dashboard user.
- Google login alone does not grant dashboard access.
- Access is granted by local user/role records.
- Never allow deleting, deactivating, or demoting the last active owner.
- Public request APIs must not trust song title/artist from the client.

## Event rules

- Only one public active event can exist.
- Events default to 8 hours.
- Events can be extended by 1h or 2h.
- Manual close closes the event but does not mutate existing request statuses.
- Lazy auto-close is server-side.
- `/dashboard` is an overview, not a redirect.

## QR/session rules

- QR codes point to `/session/[code]`.
- QR codes are access links, not event IDs.
- Old/revoked codes must not redirect to the new code.
- A code can be rotated.
- A non-revoked inactive code can be restored.
- A revoked code cannot be restored.

## Participant rules

- Participants have lightweight cookie sessions.
- Nickname is required.
- First name/last name are not required for MVP.
- Operator must be able to see whether a singer is first-time in the current event.
- First-time means no previous `now` or `done` request as singer in the same event.
- Co-singers should be chosen from known participants first.
- Manual co-singer entry is fallback only.
- Manual singers have no reliable history.

## Import rules

- Never truncate or delete `songs` during import.
- Failed import must not break the current catalog.
- Imports must be upsert-based.
- KaraFun and iSing imports must be jobs with visible status/counters/errors.
- Do not run long imports inside a blocking browser request.

## Work rules

- One feature = one commit.
- Do not mix unrelated refactors with feature work.
- Do not recreate removed legacy `apps/api` or `apps/web` code.
- Do not touch `data` unless explicitly requested.
- Do not change schema without Drizzle migration.
- Do not run destructive database operations.
- Do not commit automatically.
- After changes, run:
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm build`
  - `git diff --check`

## Stop conditions

Stop and ask/report if:
- a migration fails,
- auth/session behavior cannot be smoke tested,
- `pnpm build` fails,
- browser smoke test hangs because of tooling,
- a task would require changing unrelated modules,
- a destructive import/delete/truncate seems necessary.
