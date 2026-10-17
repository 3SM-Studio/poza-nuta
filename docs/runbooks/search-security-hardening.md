# Search security hardening proposals

This is a review runbook, not a migration or authorization to change production.
Target authorized by the owner: Supabase `qwmimnhdnzqfckswxjww`, serving the existing
Vercel project `pozanuta` and URL `https://pozanuta.vercel.app`. Never infer the
environment from the project's display name. No domain/alias changes are needed.

## Evidence and boundaries

The task's supplied production audit reports an `event_trigger` function
`public.rls_auto_enable()`, owner `postgres`, SECURITY DEFINER and public execute
grants. Those observations are historical input, not fresh findings of this run.
The current session has no project-scoped `supabase-dev` connector and the checked
application environment files contain loopback targets only. No production SQL
connection was opened. Do not treat a synthetic local analogue as the hosted
function definition or proof of current hosted grants.

PostgreSQL rejects direct SELECT invocation of an event-trigger function, even
when EXECUTE is granted. Local negative tests confirm SQLSTATE `0A000` before a
revoke and `42501` after it. This is avoidable privilege exposure, not evidence
of an exploitable RPC or bypass of RLS. The synthetic event trigger still enables
RLS after EXECUTE is revoked from browser roles.

## Proposed grant reduction — separate approval required

1. Use the verified project-scoped read-only connection. Inspect `pg_proc`,
   `pg_event_trigger`, function definition, owner, search path, ACL and dependencies.
   Review dynamic SQL identifier quoting and affected schemas. Record the exact
   original ACL privately, without credentials or participant data.
2. Stop if the function isn't a zero-argument event-trigger function, has an
   unexpected owner/body, or is used through another supported application API.
3. With separate approval and a verified backup, use a short transaction to
   `REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;`.
   Keep the trigger, its owner and RLS enabled. Do not change default privileges
   for unrelated functions, schemas or roles.
4. Verify `has_function_privilege` for both browser roles and trigger enabled state.
   Verify automatic RLS on a disposable test table in an approved isolated clone;
   do not create an arbitrary production table for a smoke test.
5. If needed, restore only the recorded prior ACL after approval. Do not use a
   blanket GRANT, disable the trigger, or disable RLS as rollback.

This proposal is deliberately not added as an unconditional Drizzle migration:
the hosted function is managed outside the repository and its actual definition
and dependencies have not been reverified. The separately reviewed application performance change adds only the 0034 derived
index; it changes no roles, grants or RLS. See song-search-fuzzy-distance-index.md.

## RLS and Realtime

RLS with no browser policies is intentional for backend-only business tables.
The application API validates sessions, local RBAC, organization/event scope and
uses Drizzle. Lack of SELECT policies is not a reason to grant anon/authenticated
access. The local migration chain through 0033 is tested for RLS and absence of
browser SELECT grants on public business tables.

Realtime policies on `realtime.messages` are separate from business-table access.
Preserve private dashboard membership checks and scoped public-session channel
checks. Messages remain invalidation signals, without business rows. Existing
queue, identity and collaboration migrations are unchanged by this task. A hosted
grant change must additionally pass private/public subscribe and reconnect smoke
tests before being proposed for production.

## pg_trgm

Do not move the extension automatically. Existing GIN indexes, operators,
functions, migration 0031 and runtime search SQL depend on current operator
resolution. An extension move does not repair the measured fuzzy scan/sort cost.
The initial plain-column GiST/KNN prototype worsened a broad single-word typo
query and is not shipped. The later isolated expression index is used only for
multi-token fuzzy; its tradeoffs and measured index size are documented separately.
If moving the extension is later required, inventory `pg_depend`, function
search paths, runtime role search paths and index operator classes in an isolated
restore, then test legacy/v2 search, imports, backfill and rollback. No extension
move is part of this checkpoint. Migration 0034 adds the separate expression index.

## Auth

Supabase documents leaked-password protection as available on Pro and above:
https://supabase.com/docs/guides/auth/password-security . Current hosted plan and
Auth settings have not been independently read in this run. The supplied audit
reports protection disabled. Ask for separate approval to enable it if supported;
do not upgrade the plan or change Auth here. On a plan without this option, keep
existing password requirements, operator authorization and available MFA controls;
do not claim an application password-length check replaces breach detection.

## Anonymous search budgets

The application applies a process-local 120 searches/minute/device budget, or
120/minute/network when no valid participant-cookie shape is present. A separate
2400/minute/network budget caps cookie rotation. Cookie hashes partition a venue
network but do not authenticate a request. Session access is checked independently.
Search counters have their own bounded map and do not consume mutation quotas.

These counters are atomic within one JS process but are neither distributed nor
durable. Multiple Vercel instances each have their own allowance. Forwarded client
addresses must be supplied/overwritten by the trusted ingress, not a direct
untrusted proxy. No IP, credential or query values are logged by these changes.

Before claiming protection against distributed resource abuse, inspect effective
Vercel WAF coverage for all public/code/token search paths and propose a NAT-aware
aggregate rule, with 429 monitoring and venue smoke tests, for separate approval.
Do not reuse a restrictive code-enumeration rule as the sole karaoke search quota.
Changing WAF settings or installing a shared rate-limit service is outside this task.

## Release and rollback

This local checkpoint does not authorize push/deployment or remote SQL. Search
normalization, ranking, fuzzy threshold, candidate limits, cursors and 2s SQL
timeout remain unchanged. Cache staleness is limited to catalog discovery data;
new imports reach every live process after at most its 60s TTL on the next read.
Completed search results are not cached. Reverting the application checkpoint
needs no database rollback. Preserve all previous integration/realtime commits.
`SONG_SEARCH_ENGINE=legacy` remains an existing separately controlled rollback,
with the known loss of non-Latin search; changing engines invalidates old cursors.
Neither engine flag nor production configuration was changed here.

## References

- https://www.postgresql.org/docs/17/pgtrgm.html
- https://www.postgresql.org/docs/17/event-trigger-definition.html
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/auth/password-security
