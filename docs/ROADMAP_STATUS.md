# Poza Nutą — Roadmap Status

Date: 2026-07-15
Branch: `feat/platform-stage-1`
Implementation baseline: `a684151 test: add Vitest component testing foundation`
Repository: `VictorAsvira/poza-nuta`

This document is an operational status snapshot of the current Poza Nutą repo.
Strategic goals, target architecture, and longer-term sequencing remain in
`docs/project-roadmap.md`.

## Executive Summary

The project is close to a functional demo. The repository is prepared as a
Vercel-ready root project: the Next.js application, `package.json`,
`next.config.ts`, and `src/app` live at the repository root.

According to the most recent user-run database checks, Supabase migrations,
seed data, and `db:check` have passed. The iSing catalog import has completed:
`processed=2754`, `inserted=2654`, `updated=100`, `errors=0`.

The public product shell now has a neutral nationwide homepage, public event
directory, shared public header, and informational `/events/[slug]` pages.
Song requests do not start from public slugs. Guest request/search/optional
queue access starts from `/session/[code]`, where the code resolves one
concrete event. `songRequestsEnabled` and `publicQueueEnabled` are independent
capabilities. Global public request and queue endpoints are tombstone `410`
routes.

Multi-organization dashboard routing has started: organization maps to
`workspaces`, `organizationId` maps to `workspaces.public_id`, and org pages
check membership through `workspace_members`. Organization settings are now
canonical at `/dashboard/org/[organizationId]/settings`; the older
`/settings/general` route redirects back to `/settings`. The team route is a
read-only MVP. Account settings now have a read-only `/dashboard/account/me`
view. Google account linking is not started.

The largest remaining demo risk is runtime confirmation: Vercel deploy, Vercel
environment variables, Supabase Auth redirect URLs, authenticated dashboard
smoke testing, and database-backed coverage for the critical session flow.

## Status Table

| Area | Status | Evidence from repo or latest run | Next step |
| --- | --- | --- | --- |
| GitHub repo | LOCAL COMMIT AHEAD | Feature branch `feat/platform-stage-1` contains implementation through `a684151`; `origin/feat/platform-stage-1` remains at `5de056b` in this snapshot. | Push only after explicit approval; review and smoke should block merge/deploy. |
| Vercel readiness | DONE | `docs/DEPLOYMENT.md` defines Root Directory `.`, `pnpm install`, `pnpm build`, Node.js `24.x`; `package.json` has `packageManager` and Node `>=24`. | Import the GitHub repo into Vercel with root directory `.`. |
| Vercel deploy | BLOCKER FOR DEMO | Repo is ready, but no confirmed production deployment URL or production smoke result is recorded. | Confirm the Vercel project and latest deployment. |
| Vercel ENV | BLOCKER FOR DEMO | Required env vars are documented, but live Vercel settings were not inspected in this snapshot. | Set or verify `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. |
| Supabase migrations | DONE | User reports migrations passed; `drizzle/` includes migrations through realtime broadcast and workspace/import-job schema. | Do not rerun production migrations without explicit approval and backup context. |
| Supabase seed | DONE | User reports `db:seed` passed; `docs/DEPLOYMENT.md` and `docs/DB_TROUBLESHOOTING.md` document the seed order. | Confirm seeded production event/workspace before demo. |
| Supabase Auth | PARTIAL | Supabase Auth SSR is implemented; dashboard routes call `requireOperatorSession`; local operator mapping is required. | Confirm login works on the production URL with the intended operator. |
| Google account linking | NOT STARTED | `/dashboard/account/me` is read-only and does not call link/unlink identity APIs. | Decide later whether Google linking is needed after dashboard smoke. |
| Auth redirect URLs | BLOCKER FOR DEMO | Required for production auth, but no evidence in repo proves Supabase dashboard redirect URLs are configured. | Add Vercel production URL to Supabase Auth redirect URLs. |
| Public landing | DONE | `/` is a neutral public discovery homepage under `src/app/(public)/page.tsx`; it links into the event directory and dashboard without offering global request creation. | Smoke test on production URL. |
| Public event directory/detail | DONE | `/events` lists public events with filters/sorting; `/events/[slug]` is informational and does not create song requests. | Add organizer/venue/profile relations in a later stage. |
| Public queue | PARTIAL | The global `/queue` page is removed and `/api/public/queue` is a legacy 410 tombstone. Participant queue access is available through `/session/[code]` only when `publicQueueEnabled` is true for the resolved event. | Smoke test session-scoped queue visibility and Realtime invalidation on the production URL. |
| Public request flow | PARTIAL | Public request creation is session-code scoped through `/session/[code]` and `/api/session/[code]/requests`; requests are stored against the event resolved from the code. Account login is not required. | For demo: smoke test request creation. For production: add rate limiting/anti-spam and database-backed E2E coverage. |
| Dashboard | PARTIAL | `/dashboard` exists and is protected by Supabase session plus local operator record. Authenticated production QA is not yet recorded. | Run authenticated dashboard smoke on Vercel. |
| Dashboard queue | DONE | Event-scoped queue routes under `/dashboard/org/[organizationId]/events/[eventId]/queue` are active; legacy global dashboard/operator queue routes redirect or remain compatibility paths. Tests cover transition policy, scoping and client paths. | Confirm on production with real request data. |
| Dashboard settings | DONE | `/dashboard/settings` exists and event settings APIs are implemented. | Confirm on production with a non-destructive settings smoke. |
| Multi-organization routing | PARTIAL | `/dashboard/organizations`, `/dashboard/organizations/new`, `/dashboard/org/[organizationId]`, `/dashboard/org/[organizationId]/settings`, `/dashboard/org/[organizationId]/settings/general`, `/dashboard/org/[organizationId]/events`, and `/dashboard/org/[organizationId]/team` are implemented with workspace membership checks. `organizationId` maps to `workspaces.public_id`; handle is not a URL alias. `/settings` is canonical and `/settings/general` redirects to it. Existing bootstrap scripts do not create `workspace_members` automatically for previously linked operators. | Run the public ID migration, confirm the demo operator has an active `workspace_members` row for the target workspace, and smoke test org creation/settings/team. |
| Organization settings | PARTIAL | Org-scoped settings can show `public_id`, update name, and archive by setting `workspaces.active=false`. Mutations are owner-only. There is no full audit trail or last-owner protection for this org-scoped archive flow yet. | Smoke test on Vercel with a disposable organization before using on important data. |
| Organization team | PARTIAL | `/dashboard/org/[organizationId]/team` lists local workspace members read-only with local operator name/auth id, role, and active state. It does not invite users or query Supabase Auth admin data. | Add member invite/role management later with explicit RBAC and service-role design. |
| Account route | DONE | `/dashboard/account/me` displays safe read-only Auth/operator details and login methods without tokens. | Smoke test after login on Vercel. |
| Realtime queue | PARTIAL | Migration `0004_dashboard_queue_realtime_broadcast.sql` creates a private dashboard trigger/policy; dashboard and session queue clients use Realtime as an invalidation signal and refetch through event-scoped APIs. | Verify dashboard and session-scoped Realtime with authenticated and participant browsers. |
| Event lifecycle | DONE | Start, extend, close, lazy auto-close, warning helper, and audit logging exist with tests. | Production smoke start/extend/close only with a safe demo event. |
| Event access links | DONE | Backend and dashboard UI create/list/revoke hash-only event access links; raw code is only returned on create; `/session/[code]` uses these links to resolve one event. | Decide the separate short human-entry code UX later. |
| iSing importer | DONE | `pnpm db:import:ising` exists; safety guard, dry-run, pagination, mapping, and tests are implemented. | Do not modify unless import quality or iSing API behavior changes. |
| iSing imported catalog | DONE | Latest user-run import completed: `processed=2754`, `inserted=2654`, `updated=100`, `errors=0`. | Confirm Vercel `DATABASE_URL` points to this same populated database. |
| Import jobs | PARTIAL | `import_jobs` schema exists, but there is no dashboard import status UI or automation. | Keep CLI/manual import for demo; design import jobs UI later. |
| Platform admin contract | DOCUMENTED / `/admin` NOT IMPLEMENTED | The accepted roles, owner-only platform-role mutations, eligible-owner invariant, application suspension, read-only Organizations MVP, retention and import-job delivery plan are documented in `docs/features/platform-admin-dashboard.md`. Ticket 2 Vitest Foundation is complete, but no `/admin` route, guard, shell or service exists. | Implement Ticket 3 Platform Authorization Policy next; keep later migrations, domain services, infrastructure and UI in their scoped tickets. |
| Platform roles | FOUNDATION / CONSTRAINT CHANGE REQUIRED | `platform_members` already supports `platform_owner`, `platform_admin` and `support`, but the current unique index allows only one active owner and setup logic expects exactly one. Only owner may mutate any platform role; admin performs no `platform_members` mutations. | Safely allow multiple eligible owners and add concurrency-safe last-owner protection before role-management UI. |
| Admin suspension and retention | DECIDED / NOT IMPLEMENTED | Suspension is application-level and preserves Supabase identity, memberships and history. Retention is 365 days for audit/job metadata, 30 days for safe error details and at most 7 days for private KaraFun files. | Discover the compatible data representation and cleanup mechanism without selecting storage or scheduler prematurely. |
| Vitest foundation | DONE | Commit `a684151` adds an isolated Vitest runner, jsdom component environment and one local shadcn Button test while preserving `node:test` and Playwright. | Use Vitest for new unit/component coverage starting with the platform authorization policy; do not migrate existing suites wholesale. |
| Dark/neon theme | DONE | Theme is implemented in app CSS and component styles; latest QA passed build/test checks. | Only do targeted visual fixes before demo. |
| Logo branding | DONE | Logo asset is committed under `public/brand/poza_nuta_logo-white.png`; public and dashboard branding use it. | Keep root logo out of Git unless explicitly needed. |
| Mobile/accessibility QA | PARTIAL | Recent browser QA checked public views and dark theme basics; no full release-grade mobile/accessibility matrix is recorded. | Add demo smoke notes for mobile widths and focus states. |
| Rate limiting / anti-spam | BLOCKER FOR PRODUCTION | Public endpoints validate input, but there is no rate limiting or abuse protection layer. | Add rate limiting before wider production use. |
| QR/session flow | PARTIAL | `/session/[code]` is implemented for event-scoped search, guest request creation and optional public queue. Future short room codes, guest continuity sessions, own-request tracking, cancellation and account claim are not implemented. | Runtime-smoke the existing flow, then design short codes and guest continuity separately. |
| Multi-operator management | BLOCKER FOR PRODUCTION | Workspace/member schema exists, but there is no owner/admin UI or full RBAC management workflow. | Implement after dashboard flow is proven. |
| Observability | BLOCKER FOR PRODUCTION | No Sentry/production error monitoring or incident workflow is documented. | Add observability after baseline production smoke. |
| Backups / rollback | BLOCKER FOR PRODUCTION | Docs mention needing backup/rollback before production migrations, but no concrete runbook is present. | Document backup, restore, rollback, and migration approval process. |
| E2E tests | PARTIAL | Playwright/E2E tests exist, but runtime/auth/database coverage remains partial and no production smoke artifact is recorded. | Create `docs/PRODUCTION_SMOKE.md`, then add database-backed E2E coverage for the critical flow. |

## Demo Blockers

- Confirm the Vercel deployment.
- Set or verify Vercel environment variables.
- Configure Supabase Auth redirect URLs for the Vercel production URL.
- Run authenticated dashboard smoke.
- Confirm the operator has an active `workspace_members` row for the demo
  workspace.
- Run `/session/[code]` request to event-scoped dashboard queue smoke.
- Confirm dashboard realtime queue updates in two authenticated windows and
  session-scoped participant queue invalidation refreshes without errors.
- Confirm Vercel uses the same Supabase database that contains the imported
  iSing catalog.

## Production Blockers

- Rate limiting / anti-spam.
- Full RBAC / multi-operator management.
- Google account linking, if it becomes a product requirement.
- Observability.
- Backup/rollback.
- E2E tests.
- Import automation/cron.
- Platform admin RBAC and audit-backed operations.
- Documented incident procedure.

## Out Of Order / Already Done

These items are already implemented earlier than the strategic roadmap suggests
or are more advanced in the repo than the roadmap's "next step" language:

- Dark theme.
- Logo branding.
- iSing importer.
- Realtime queue.
- Multi-organization routing foundation.
- Read-only account route.
- Source badge.
- Event access links.

## Do Not Do Now

- Do not do a larger redesign.
- Do not implement short codes or guest continuity before demo smoke of the
  existing `/session/[code]` flow.
- Do not develop multi-operator UI before confirming the dashboard flow.
- Do not add new migrations without a clear reason.
- Do not do observability before the basic production smoke.
- Do not touch importers if the catalog works.

## Recommended Next 10 Steps

1. Confirm the Vercel project and latest deployment.
2. Set or verify ENV on Vercel.
3. Add Supabase Auth redirect URLs for Vercel.
4. Log in as an operator on the production URL.
5. Check `/dashboard`, event-scoped queue and settings routes.
6. Check public discovery, `/events`, and `/events/[slug]`.
7. Check `/session/[code]` search and adding a guest request.
8. Check whether the request appears in the event-scoped dashboard queue.
9. Check realtime in two windows and write the result in
   `docs/PRODUCTION_SMOKE.md`.
10. Only then decide whether rate limiting or short-code/guest-continuity work
    is next.

This document is a status snapshot. Strategic goals remain in
`docs/project-roadmap.md`.
