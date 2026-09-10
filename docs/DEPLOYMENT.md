# Deployment

## Vercel

- Root Directory: `.`
- Install Command: `pnpm install`
- Build Command: `pnpm build`
- Node.js: `24.x`

This repository is not an `apps/web` or `apps/studio` monorepo. The Next.js
application, `package.json`, `next.config.ts`, and `src/app` live at the
repository root.

## Required environment variables

Set runtime variables in Vercel and administration variables only in the local
shell used for controlled database operations:

- `DATABASE_URL` - Vercel runtime only. It must be a Supabase Transaction
  Pooler connection string on port `6543`.
- `DIRECT_URL` - Drizzle migrations and one-off database administration only.
  Use a Direct connection or the Supabase Session Pooler on port `5432`; do not
  configure this variable in the Vercel runtime.
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` - Supabase publishable/anon key.
- `SUPABASE_URL` - server-side Supabase project URL.
- `SUPABASE_SECRET_KEY` - server-only Supabase secret key for the one-time setup
  invite flow. Do not expose it as `NEXT_PUBLIC_*`.
- `SITE_URL` - canonical public application origin, for example
  `https://poza-nuta.vercel.app`.
- `PLATFORM_SETUP_TOKEN_SHA256` - SHA-256 hash of the one-time setup token.
- `AUTH_INVITE_COOKIE_SECRET` - server-only secret with at least 32 random bytes,
  used to HMAC-sign the short-lived setup invite cookie.
- `OPERATOR_AUTH_USER_ID` - Supabase Auth user id to link to the local operator.
- `OPERATOR_BOOTSTRAP_NAME` - initial local operator display name.
- `OPERATOR_BOOTSTRAP_PIN` - temporary PIN used only by `pnpm db:seed:operator`.

Do not commit `.env`, `.env.local`, service role keys, or other secrets.

## Initial platform setup

The `/setup` bootstrap flow uses Supabase Admin invite and requires public
signups to be disabled in Supabase Auth. Configure the Supabase **Invite user**
email template link as:

```text
{{ .SiteURL }}/auth/invite?token_hash={{ .TokenHash }}&type=invite
```

Do not include the setup token in the email template, URL, cookies, user
metadata, or logs. `/auth/invite` only stores the Supabase invite token hash in a
short-lived, HttpOnly, HMAC-signed cookie and redirects to
`/auth/invite/accept`. The token is verified only after the user submits the
explicit POST to `/auth/confirm`, which redirects to `/setup` on success.

Disable email link tracking for this invite template. Email security scanners
and link prefetchers must not cause a state-changing request on the first GET.

Set Supabase Auth **Site URL** to the canonical `SITE_URL`. If
`inviteUserByEmail` is configured with `redirectTo`, allowlist the application
origin and `/auth/invite` redirect URL for localhost and production.

## Database setup

Apply Drizzle migrations only against the intended database:

```bash
pnpm db:migrate
```

Do not run migrations against production without an explicit confirmation and a
rollback/backup plan.

## Seed event data

After migrations, seed the baseline event/workspace data:

```bash
pnpm db:seed
```

This requires `DIRECT_URL`.

## Seed and link the operator

Create the initial local operator record:

```bash
pnpm db:seed:operator
```

Then create or identify the corresponding Supabase Auth user and link it to the
local operator record:

```bash
pnpm db:link:operator-auth
```

`OPERATOR_AUTH_USER_ID` must be the Supabase Auth user UUID. Google login alone
does not grant dashboard access; the local operator record must be active and
linked.

## Song import

Place source CSV files under `data/sources/` locally, then run:

```bash
pnpm db:import:karafun
```

Imports are upsert-based. Do not truncate or delete `songs` during import, and
do not run long imports inside a blocking browser request.

The KaraFun import and the local seed/link/check commands use `DIRECT_URL`.
The durable iSing worker keeps its separately scoped
`IMPORT_WORKER_DATABASE_URL` contract.

## Verification

Before deployment, run:

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
git diff --check
git status --short
```

Use the Git integration for production deployments. This repository has no
canonical manual `vercel --prod` script, so it cannot enforce cleanliness on an
arbitrary external CLI invocation. Do not deploy when `git status --short` has
output; this prevents `gitDirty=1` deployments from including uncommitted
working-tree content.

The production runtime API requires `DATABASE_URL`, but `pnpm build` should not
need a live database connection.
