SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE "public"."events" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS i
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.oid = i.indexrelid
    JOIN pg_catalog.pg_namespace AS index_namespace
      ON index_namespace.oid = index_class.relnamespace
    JOIN pg_catalog.pg_class AS table_class
      ON table_class.oid = i.indrelid
    JOIN pg_catalog.pg_namespace AS table_namespace
      ON table_namespace.oid = table_class.relnamespace
    JOIN pg_catalog.pg_am AS access_method
      ON access_method.oid = index_class.relam
    JOIN pg_catalog.pg_attribute AS indexed_column
      ON indexed_column.attrelid = table_class.oid
     AND indexed_column.attnum = i.indkey[0]
    WHERE index_namespace.nspname = 'public'
      AND index_class.relname = 'events_one_active_public_per_workspace_idx'
      AND table_namespace.nspname = 'public'
      AND table_class.relname = 'events'
      AND access_method.amname = 'btree'
      AND i.indisunique
      AND i.indisvalid
      AND i.indisready
      AND i.indnkeyatts = 1
      AND i.indnatts = 1
      AND indexed_column.attname = 'workspace_id'
      AND regexp_replace(
        pg_catalog.pg_get_expr(i.indpred, i.indrelid),
        '\s+',
        ' ',
        'g'
      ) = '(is_active_public_event = true)'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'events_one_active_public_per_workspace_idx_contract',
      MESSAGE = 'The active public event index does not match the expected contract.';
  END IF;
END
$$;
--> statement-breakpoint
DROP INDEX "public"."events_one_active_public_per_workspace_idx";
