# Poza Nutą - Codex Instructions

## Purpose

Poza Nutą is a karaoke queue application for local events.

The currently implemented product supports:
- public song search,
- public song requests,
- an optional public queue,
- dashboard sign-in with Supabase Auth,
- active-event management,
- operator queue management.

Planned capabilities are product direction, not claims about the current implementation:
- event listings and shareable event/session routes,
- QR-based participant sessions and nicknames,
- co-singers and participant history,
- participant management,
- catalog imports,
- organization members and owners.

## Sources of truth

- Treat the current codebase as the source of truth for implemented behavior.
- Treat `src/app` as the source of truth for implemented routes.
- Treat `src/db`, Drizzle schema files, and committed migrations as the source of truth for database structure.
- Do not present roadmap items as already implemented.
- Do not recreate removed legacy `apps/api` or `apps/web` code.
- Legacy `/operator/*` routes exist only for compatibility. Do not add new operator routes.

## Architecture

- Use Next.js App Router.
- Application routes live in `src/app`.
- Shared UI lives in `src/components`.
- Business logic lives in `src/server`.
- Database schema and access live in `src/db`.
- Shared helpers live in `src/lib`.
- Next.js proxy logic lives in `src/proxy.ts`.
- Keep route handlers thin: validate input, require authorization, call a server-side service, map errors, return typed responses.
- Keep business logic out of React components and route handlers.
- Use Drizzle for server-side business-table access.
- Supabase Auth provides identity and session handling only.
- Local application records decide business permissions.
- Browser code must not read business tables directly through Supabase.
- Business operations must go through server-side APIs or server actions with equivalent authorization.
- Supabase Realtime is an invalidation signal, not the business data API.
- The target runtime must remain compatible with Vercel.

## Auth and authorization

- Dashboard access requires a valid Supabase Auth session and an active local application user.
- Google sign-in alone does not grant dashboard access.
- `auth.users` proves identity.
- `operator_users` stores the local application profile.
- `workspace_members` stores organization membership and roles.
- `platform_members` stores platform-wide support, admin, or owner access.
- Never trust client-supplied roles, organization IDs, or permissions.
- Enforce authorization server-side for every protected read and mutation.
- Never allow deleting, deactivating, or demoting the last active owner.
- Do not store authentication or participant-session tokens in `localStorage` or `sessionStorage`.
- Target participant sessions should use HttpOnly cookies and hashed database tokens.

## Supabase Auth callback rules

- Email confirmation must return through the application `/auth/callback` route.
- Production and localhost callback URLs must be allowed explicitly in Supabase Auth Redirect URLs.
- Custom email templates must preserve `RedirectTo` or use `ConfirmationURL`.
- Do not construct confirmation links from `SiteURL` alone when a callback redirect is required.
- Auth redirect changes require a fresh signup and confirmation smoke test.
- Never expose authorization codes, access tokens, refresh tokens, cookies, or session contents in logs.

## Security

- Never expose `service_role`, secret keys, database passwords, tokens, or private credentials in browser code.
- Never place secrets in `NEXT_PUBLIC_*` variables.
- Never print, commit, paste, or log secrets.
- Do not modify local environment files without explicit approval.
- `.env.example` may contain placeholders only.
- Validate all untrusted input.
- Public request APIs must not trust song title or artist supplied by the client.
- Protect public endpoints with an appropriate rate-limiting plan.
- Prevent role escalation and cross-organization access.
- Use safe public error messages.
- Avoid logging personal data or complete request payloads.
- Important mutations should have an audit trail where appropriate.
- Destructive actions require explicit user intent and server-side authorization.

## Event rules

- Preserve the currently enforced single-public-active-event invariant.
- Do not change its scope or semantics without an explicit domain decision and migration plan.
- Events default to 8 hours.
- Events can be extended by 1 or 2 hours.
- Manual close closes the event without rewriting existing request statuses.
- Lazy automatic closing must run server-side.
- `/dashboard` is an overview, not a redirect.

## QR and participant-session rules

- QR codes point to `/session/[code]`.
- A QR code is an access link, not an event ID.
- Old or revoked codes must not redirect to a replacement code.
- A code may be rotated.
- A non-revoked inactive code may be restored.
- A revoked code may not be restored.
- Participant nickname is required.
- First and last name are not required for MVP.
- Operators must be able to identify whether a singer is appearing for the first time in the current event.
- First-time means no earlier request with status `now` or `done` for that singer in the same event.
- Prefer known participants when selecting co-singers.
- Manual co-singer entry is fallback only.
- Manual singers do not have reliable history.

## Queue and Realtime

- Business data comes from the application API and Drizzle.
- Browser clients must not read `song_requests` directly.
- Realtime messages should only trigger refetch or invalidation.
- Realtime payloads must be minimal and must not contain singer personal data, cookies, tokens, or full request payloads.
- Preferred topic format: `dashboard:event:{eventId}:queue`.
- Refetching on subscribe, reconnect, or window focus is allowed.
- Interval polling is not the target queue mechanism.
- Do not introduce polling as a permanent replacement for Realtime without an explicit decision.

## Catalog imports

- Never truncate or delete `songs` during an import.
- Failed imports must not break the current catalog.
- Imports must use upsert behavior.
- KaraFun and iSing imports must run as jobs with visible status, counters, and errors.
- Do not run long imports inside a blocking browser request.
- External calls need timeouts, retries, and idempotency where relevant.

## Database and migrations

- Do not change the schema without a committed Drizzle migration.
- Prefer migrations over ad-hoc database changes.
- For existing tables, use a safe expand/backfill/verify/constrain sequence when adding required data.
- Validate existing data before adding foreign keys, unique constraints, or `NOT NULL`.
- Multi-step business mutations require transactions.
- Review trigger and function payloads for secrets and oversized data.
- Do not run production migrations without explicit approval.
- Do not run destructive SQL, delete, truncate, reset, or irreversible migration operations without explicit approval.
- Every migration must include verification and rollback or forward-fix notes.

## Frontend and UI

- Respect Server Component and Client Component boundaries.
- Do not rely on UI-only authorization.
- Handle loading, error, empty, and success states.
- Forms need validation and clear user feedback.
- Use accessible labels and keyboard behavior.
- Preserve mobile and responsive behavior.
- Avoid hydration mismatches.
- Keep component changes focused.
- Do not mix a redesign with unrelated backend work.
- Code-owned UI components live in `src/components/ui`.
- Shared class merging lives in `src/lib/utils.ts`.
- Use `AlertDialog` or an equivalent confirmation flow for destructive actions.
- Do not use `window.confirm` for product UI.
- Do not add shadcn blocks, dashboards, sidebars, charts, demo pages, or example applications without explicit approval.

## Testing

Use the smallest useful verification loop during development, then run the full project checks before handing off a meaningful change.

Targeted verification may include:
- relevant unit or integration tests,
- API contract tests,
- migration verification,
- browser smoke tests,
- runtime checks through Next DevTools.

Before completing a meaningful code change, run:
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
- `git diff --check`

Additional requirements:
- Auth, RBAC, migration, and security changes require negative-path tests.
- Auth redirect changes require a fresh signup confirmation smoke test.
- Destructive UI tests should verify open and cancel first.
- Never expose credentials, cookies, tokens, or storage contents in test output.
- Do not claim a change works if required verification was not completed.
- Report commands that failed, were skipped, or could not be run.

## Work rules

- Keep changes focused and cohesive.
- Do not mix unrelated refactors with the requested task.
- Do not modify `data` unless explicitly requested.
- Do not modify local environment files without explicit approval.
- Do not commit automatically.
- Do not push, merge, deploy, modify remote services, or change production settings without explicit approval.
- Before editing, inspect the relevant code, tests, schema, and current Git state.
- Prefer small, reviewable changes over broad rewrites.
- Preserve strict TypeScript typing.
- Do not weaken types, validation, authorization, or tests to make checks pass.
- Do not hide failures with broad catches, ignored errors, skipped tests, or unsafe casts.
- Explain assumptions when current behavior is unclear.

## Stop conditions

Stop and report before continuing when:
- a migration fails,
- auth or session behavior cannot be smoke tested,
- `pnpm build` fails,
- a browser smoke test hangs because of tooling,
- the task requires unrelated module changes,
- a destructive import, delete, truncate, reset, or irreversible operation appears necessary,
- production configuration or credentials would need to change,
- the requested behavior conflicts with an existing domain invariant,
- the correct organization, environment, or Supabase project cannot be verified.

## Skills

Use the relevant project skill from `.agents/skills` when the task matches it.

Project-specific skills take precedence over generic vendor guidance for Poza Nutą decisions:
- architecture review,
- backend and API production rules,
- database migration review,
- frontend and Next.js rules,
- operations and observability,
- Realtime queue rules,
- security review,
- shadcn and Radix UI rules,
- Supabase Auth and RBAC,
- testing strategy.

Generic vendor skills may supplement project rules but must not override them.

## MCP and tool policy

Keep tool scope narrow. Report external services and MCP tools used.

### Next DevTools

Use for:
- Next.js App Router runtime behavior,
- route detection,
- proxy behavior,
- development-server and build issues,
- runtime errors and route structure.

Do not treat a successful build as proof that runtime behavior is correct.

### Supabase

- Use only the project-scoped `supabase-dev` MCP for this repository.
- Verify the project URL or project reference before the first database-related action in a session.
- Read-only inspection is allowed.
- `execute_sql` and `apply_migration` require explicit approval.
- Prefer committed Drizzle migrations over ad-hoc SQL.
- Never connect to or mutate production Supabase unless explicitly authorized.
- Never expose secrets returned by project or environment tools.

### shadcn

Use for:
- checking component documentation,
- searching the registry,
- adding approved foundation components,
- verifying project configuration.

Do not add blocks, sidebars, dashboards, charts, demo pages, or generated example applications without explicit approval.

### Context7

Use when current library documentation is needed, especially for:
- Next.js,
- React,
- Supabase,
- Drizzle,
- Zod,
- React Hook Form,
- Radix UI,
- shadcn.

Prefer official and primary documentation.

### Browser and Playwright

Use available browser tooling or the existing Playwright test suite for:
- browser smoke tests,
- redirects,
- dashboard flows,
- dialogs, menus, and forms.

Rules:
- Do not perform destructive UI actions without explicit approval.
- Test the cancel path before a final destructive confirmation.
- Do not expose credentials, cookies, tokens, or local storage contents.

### GitHub

Use only when explicitly asked to inspect or modify remote repository state.

Do not push, merge, close issues, edit pull requests, or modify remote state without explicit approval.

### Vercel

Use only when explicitly asked to inspect deployments, logs, domains, environment variables, or project settings.

Do not deploy or change project settings, domains, or environment variables without explicit approval.

### Cloudflare

Use only when explicitly asked to inspect DNS, domains, caching, Workers, or Cloudflare configuration.

Do not modify DNS, routes, Workers, SSL, caching, or security settings without explicit approval.

## Completion report

At the end of a task, report:
- what changed,
- files changed,
- tests and checks run,
- skipped or failed verification,
- migrations or external-service actions,
- MCPs and external tools used,
- remaining risks or follow-up work.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
