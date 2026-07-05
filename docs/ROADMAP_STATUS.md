# Poza Nutą — Roadmap Status

Date: 2026-07-05  
Branch: `main`  
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

The dark/neon theme and logo branding are implemented. Public navigation now
shows an entry point to the dashboard only when an active operator session is
present, and `/queue` has a logo, separator, and title in one header line.

The largest remaining demo risk is not missing code in the repo, but missing
production confirmation: Vercel deploy, Vercel environment variables, Supabase
Auth redirect URLs, and authenticated dashboard smoke testing on the production
URL.

## Status Table

| Area | Status | Evidence from repo or latest run | Next step |
| --- | --- | --- | --- |
| GitHub repo | DONE | `origin` is `https://github.com/VictorAsvira/poza-nuta.git`; branch is `main`; latest pushed UI commit is on `main`. | Keep `main` deployable and avoid committing local secrets or import data. |
| Vercel readiness | DONE | `docs/DEPLOYMENT.md` defines Root Directory `.`, `pnpm install`, `pnpm build`, Node.js `24.x`; `package.json` has `packageManager` and Node `>=24`. | Import the GitHub repo into Vercel with root directory `.`. |
| Vercel deploy | BLOCKER FOR DEMO | Repo is ready, but no confirmed production deployment URL or production smoke result is recorded. | Confirm the Vercel project and latest deployment. |
| Vercel ENV | BLOCKER FOR DEMO | Required env vars are documented, but live Vercel settings were not inspected in this snapshot. | Set or verify `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. |
| Supabase migrations | DONE | User reports migrations passed; `drizzle/` includes migrations through realtime broadcast and workspace/import-job schema. | Do not rerun production migrations without explicit approval and backup context. |
| Supabase seed | DONE | User reports `db:seed` passed; `docs/DEPLOYMENT.md` and `docs/DB_TROUBLESHOOTING.md` document the seed order. | Confirm seeded production event/workspace before demo. |
| Supabase Auth | PARTIAL | Supabase Auth SSR is implemented; dashboard routes call `requireOperatorSession`; local operator mapping is required. | Confirm login works on the production URL with the intended operator. |
| Auth redirect URLs | BLOCKER FOR DEMO | Required for production auth, but no evidence in repo proves Supabase dashboard redirect URLs are configured. | Add Vercel production URL to Supabase Auth redirect URLs. |
| Public landing | DONE | `/` exists in `src/app/page.tsx`; public request page supports search/request flow and dashboard entry visibility for active operators. | Smoke test on production URL. |
| Public queue | DONE | `/queue` exists; public queue API and UI are implemented; header branding is updated. | Smoke test queue visibility settings on production URL. |
| Public request flow | PARTIAL | Public search and request APIs exist and validate input; requests are stored against the active event. No participant session gating yet. | For demo: smoke test request creation. For production: add session/anti-spam controls. |
| Dashboard | PARTIAL | `/dashboard` exists and is protected by Supabase session plus local operator record. Authenticated production QA is not yet recorded. | Run authenticated dashboard smoke on Vercel. |
| Dashboard queue | DONE | `/dashboard/queue` exists; operator actions and source badges are implemented; tests cover transition policy and client paths. | Confirm on production with real request data. |
| Dashboard settings | DONE | `/dashboard/settings` exists and event settings APIs are implemented. | Confirm on production with a non-destructive settings smoke. |
| Realtime queue | PARTIAL | Migration `0004_dashboard_queue_realtime_broadcast.sql` creates trigger/policy; client hook subscribes to private broadcast and refetches via API. Not yet production-smoked on two windows. | Verify realtime with two authenticated dashboard windows. |
| Event lifecycle | DONE | Start, extend, close, lazy auto-close, warning helper, and audit logging exist with tests. | Production smoke start/extend/close only with a safe demo event. |
| Event access links | DONE | Backend and dashboard UI create/list/revoke links; raw code is only returned on create; tests cover code generation and hashing. | Decide whether access links remain auxiliary or feed the future QR/session flow. |
| iSing importer | DONE | `pnpm db:import:ising` exists; safety guard, dry-run, pagination, mapping, and tests are implemented. | Do not modify unless import quality or iSing API behavior changes. |
| iSing imported catalog | DONE | Latest user-run import completed: `processed=2754`, `inserted=2654`, `updated=100`, `errors=0`. | Confirm Vercel `DATABASE_URL` points to this same populated database. |
| Import jobs | PARTIAL | `import_jobs` schema exists, but there is no dashboard import status UI or automation. | Keep CLI/manual import for demo; design import jobs UI later. |
| Dark/neon theme | DONE | Theme is implemented in app CSS and component styles; latest QA passed build/test checks. | Only do targeted visual fixes before demo. |
| Logo branding | DONE | Logo asset is committed under `public/brand/poza_nuta_logo-white.png`; public and dashboard branding use it. | Keep root logo out of Git unless explicitly needed. |
| Mobile/accessibility QA | PARTIAL | Recent browser QA checked public views and dark theme basics; no full release-grade mobile/accessibility matrix is recorded. | Add demo smoke notes for mobile widths and focus states. |
| Rate limiting / anti-spam | BLOCKER FOR PRODUCTION | Public endpoints validate input, but there is no rate limiting or abuse protection layer. | Add rate limiting before wider production use. |
| QR/session flow | BLOCKER FOR PRODUCTION | Event access links exist, but `/join/{workspaceHandle}`, participant sessions, and public request gating are not implemented. | Decide QR/session model after demo smoke. |
| Multi-operator management | BLOCKER FOR PRODUCTION | Workspace/member schema exists, but there is no owner/admin UI or full RBAC management workflow. | Implement after dashboard flow is proven. |
| Observability | BLOCKER FOR PRODUCTION | No Sentry/production error monitoring or incident workflow is documented. | Add observability after baseline production smoke. |
| Backups / rollback | BLOCKER FOR PRODUCTION | Docs mention needing backup/rollback before production migrations, but no concrete runbook is present. | Document backup, restore, rollback, and migration approval process. |
| E2E tests | BLOCKER FOR PRODUCTION | Unit/integration-style Node tests exist; no full browser E2E suite or recorded production smoke artifact exists. | Create `docs/PRODUCTION_SMOKE.md`, then add E2E coverage for the critical flow. |

## Demo Blockers

- Confirm the Vercel deployment.
- Set or verify Vercel environment variables.
- Configure Supabase Auth redirect URLs for the Vercel production URL.
- Run authenticated dashboard smoke.
- Run public request to dashboard queue smoke.
- Confirm realtime queue updates in two windows.
- Confirm Vercel uses the same Supabase database that contains the imported
  iSing catalog.

## Production Blockers

- Rate limiting / anti-spam.
- QR/session gating.
- Full RBAC / multi-operator management.
- Observability.
- Backup/rollback.
- E2E tests.
- Import automation/cron.
- Documented incident procedure.

## Out Of Order / Already Done

These items are already implemented earlier than the strategic roadmap suggests
or are more advanced in the repo than the roadmap's "next step" language:

- Dark theme.
- Logo branding.
- iSing importer.
- Realtime queue.
- Source badge.
- Event access links.

## Do Not Do Now

- Do not do a larger redesign.
- Do not start QR/session before demo smoke.
- Do not develop multi-operator UI before confirming the dashboard flow.
- Do not add new migrations without a clear reason.
- Do not do observability before the basic production smoke.
- Do not touch importers if the catalog works.

## Recommended Next 10 Steps

1. Confirm the Vercel project and latest deployment.
2. Set or verify ENV on Vercel.
3. Add Supabase Auth redirect URLs for Vercel.
4. Log in as an operator on the production URL.
5. Check `/dashboard`, `/dashboard/queue`, and `/dashboard/settings`.
6. Check public search and adding a request.
7. Check whether the request appears in dashboard queue.
8. Check realtime in two windows.
9. Write the result in `docs/PRODUCTION_SMOKE.md`.
10. Only then decide whether QR/session or rate limiting is the next feature.

This document is a status snapshot. Strategic goals remain in
`docs/project-roadmap.md`.
