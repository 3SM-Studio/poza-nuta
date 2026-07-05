# DB Troubleshooting

## Safe order

Run seed scripts only after migrations finish successfully:

```bash
pnpm db:migrate
pnpm db:check
pnpm db:seed
pnpm db:seed:operator
pnpm db:link:operator-auth
```

Do not run production migrations without explicit confirmation and a
rollback/backup plan.

## Connection strings

Use a Direct connection or Supabase Session pooler for Drizzle migrations and
one-off database scripts. Use the Supabase Transaction pooler for Vercel
runtime.

`DATABASE_URL` must never be committed or printed in logs.

## Vercel production runtime

For Vercel serverless production, `DATABASE_URL` should point to the Supabase
Transaction pooler, not a Direct database connection. Direct connections are
better suited for migrations and short one-off scripts, while serverless
runtime needs a small connection footprint.

The runtime Postgres client is configured with:

- a very small pool (`max: 1`),
- prepared statements disabled (`prepare: false`) for pooler compatibility,
- connection timeout,
- idle timeout,
- statement timeout / idle transaction timeout.

If Supabase Auth or Postgres is unavailable, API routes should return a
controlled `503 SERVICE_UNAVAILABLE` response instead of waiting for the Vercel
function timeout.

Do not log `DATABASE_URL` or full connection strings. After changing Vercel
environment variables, redeploy the project so the serverless runtime receives
the new configuration.

## Checking state

Use:

```bash
pnpm db:check
```

The check is read-only. It reports whether key tables exist, whether
`workspaces(handle)` has a unique index or constraint, where Drizzle migration
metadata lives, and which migration hashes are recorded as executed.

## Partially migrated databases

If a new database is partially migrated, the simplest recovery is usually:

1. confirm that it is not production data,
2. reset the `public` schema,
3. run Drizzle migrations from zero,
4. run seeds only after migrations pass.

Do not reset production data without an explicit approval and backup plan.

## Operator bootstrap

`OPERATOR_BOOTSTRAP_PIN` is required by `pnpm db:seed:operator` and must not be
`change-me`.

`OPERATOR_AUTH_USER_ID` is required by `pnpm db:link:operator-auth` and must be
the UUID of an existing Supabase Auth user.
