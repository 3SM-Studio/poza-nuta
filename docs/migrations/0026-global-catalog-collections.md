# Migration 0026: global catalog collections

## Scope and risk

Migration `0026_hesitant_quasimodo.sql` is additive. It creates three enums and
the global `catalog_collections` and `catalog_collection_items` tables. It does
not update, delete, or backfill an existing row. Collection membership keeps a
local bigint foreign key to `songs.id`; public URLs use only the stable,
validated `filter_key`.

Both tables enable RLS without public policies. Migration 0026 revokes default
Data API privileges from `anon` and `authenticated` (including the new identity
sequences), then explicitly grants only `SELECT` on the new tables to the
server runtime `postgres` role. Vercel's `DATABASE_URL` guard requires that
role through the transaction pooler. Supabase's `postgres` role has
`BYPASSRLS`, so the server can read the tables even if a different migration
owner created them; browser/Data API roles cannot. Do not replace this with a
public SELECT policy.

The expected lock risk is low: foreign-key validation reads the existing
`songs` table while the new item table is empty. Apply only through the normal
Drizzle migration path in an explicitly approved environment. This task does
not apply the migration to a live database.

## Read-only verification

After an approved DEV migration, run:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('catalog_collections', 'catalog_collection_items')
ORDER BY table_name;

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('catalog_collections', 'catalog_collection_items')
ORDER BY table_name, ordinal_position;

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid IN (
  'public.catalog_collections'::regclass,
  'public.catalog_collection_items'::regclass
)
ORDER BY conname;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('catalog_collections', 'catalog_collection_items')
ORDER BY indexname;

SELECT count(*) AS invalid_collection_song_links
FROM public.catalog_collection_items AS item
LEFT JOIN public.songs AS song ON song.id = item.song_id
WHERE song.id IS NULL;

-- Run this read-only check using the actual DEV runtime connection after an
-- approved migration, without printing the connection string or credentials.
SELECT current_user AS runtime_role,
       role.rolbypassrls,
       has_table_privilege(current_user, 'public.catalog_collections', 'SELECT')
         AS can_select_collections,
       has_table_privilege(current_user, 'public.catalog_collection_items', 'SELECT')
         AS can_select_items
FROM pg_roles AS role
WHERE role.rolname = current_user;

SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE oid IN ('public.catalog_collections'::regclass,
              'public.catalog_collection_items'::regclass);

SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('catalog_collections', 'catalog_collection_items');
```

Expect both tables, both foreign keys, unique indexes for `public_id`,
`filter_key`, and `(collection_id, song_id)`, the ordered membership index on
`(collection_id, position, id)`, and zero orphaned song links.
The runtime-role query must report `postgres`, `rolbypassrls = true`, and both
SELECT privileges; both tables must have RLS enabled and FORCE disabled, with
no public policies. If any assertion fails, do not make the collection routes
public or deploy; repair the target role/privileges through an approved plan.

## Recovery

If migration 0026 fails, the migrator transaction rolls back. Once shared data
exists, correct defects with a new forward migration; do not edit an applied
0026. Dropping the new tables and enums would destroy collection data, so a
rollback is acceptable only in a disposable local/test database after the
target has been verified and no collection data needs preservation.
