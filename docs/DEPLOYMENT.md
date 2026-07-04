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

Set these in Vercel and in the local shell used for database operations:

- `DATABASE_URL` - Supabase Postgres connection string. Use the transaction
  pooler connection string for Vercel runtime and CLI jobs.
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` - Supabase publishable/anon key.
- `OPERATOR_AUTH_USER_ID` - Supabase Auth user id to link to the local operator.
- `OPERATOR_BOOTSTRAP_NAME` - initial local operator display name.
- `OPERATOR_BOOTSTRAP_PIN` - temporary PIN used only by `pnpm db:seed:operator`.

Do not commit `.env`, `.env.local`, service role keys, or other secrets.

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

This requires `DATABASE_URL`.

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

## Verification

Before deployment, run:

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
git diff --check
```

The production runtime API requires `DATABASE_URL`, but `pnpm build` should not
need a live database connection.
