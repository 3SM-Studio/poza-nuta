import { config } from "dotenv";
import postgres from "postgres";

import { requireAdminDatabaseUrl } from "./admin-database-url.ts";
import { logDatabaseError } from "./log-db-error.ts";

config({ path: [".env.local", ".env"], quiet: true });

type DatabaseClient = ReturnType<typeof postgres>;

type ExistsRow = {
  exists: boolean;
};

type MigrationTableRow = {
  table_schema: string;
  table_name: string;
};

type MigrationRow = {
  id: number | string | null;
  hash: string | null;
  created_at: number | string | Date | null;
};

type UniqueIndexRow = {
  index_name: string;
  constraint_name: string | null;
  definition: string;
};

const REQUIRED_TABLES = [
  "workspaces",
  "events",
  "operator_users",
  "workspace_members",
] as const;

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function formatExists(exists: boolean) {
  return exists ? "yes" : "no";
}

async function tableExists(client: DatabaseClient, tableName: string) {
  const [row] = await client<ExistsRow[]>`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = ${tableName}
    ) as "exists"
  `;

  return row?.exists ?? false;
}

async function getWorkspaceHandleIndexes(client: DatabaseClient) {
  return client<UniqueIndexRow[]>`
    select
      idx.relname as "index_name",
      con.conname as "constraint_name",
      pg_get_indexdef(indexes.indexrelid) as "definition"
    from pg_index indexes
    join pg_class tbl on tbl.oid = indexes.indrelid
    join pg_namespace ns on ns.oid = tbl.relnamespace
    join pg_class idx on idx.oid = indexes.indexrelid
    left join pg_constraint con on con.conindid = indexes.indexrelid
    where ns.nspname = 'public'
      and tbl.relname = 'workspaces'
      and indexes.indisunique
      and (
        select array_agg(attr.attname order by key.ordinality)
        from unnest(indexes.indkey) with ordinality as key(attnum, ordinality)
        join pg_attribute attr
          on attr.attrelid = tbl.oid
         and attr.attnum = key.attnum
      ) = array['handle']::name[]
    order by idx.relname
  `;
}

async function getMigrationTables(client: DatabaseClient) {
  return client<MigrationTableRow[]>`
    select table_schema, table_name
    from information_schema.tables
    where table_name = '__drizzle_migrations'
    order by
      case when table_schema = 'drizzle' then 0 else 1 end,
      table_schema,
      table_name
  `;
}

async function getExecutedMigrations(
  client: DatabaseClient,
  migrationTable: MigrationTableRow,
) {
  const qualifiedTable = `${quoteIdentifier(
    migrationTable.table_schema,
  )}.${quoteIdentifier(migrationTable.table_name)}`;

  return (await client.unsafe(
    `select id, hash, created_at from ${qualifiedTable} order by created_at, id`,
  )) as MigrationRow[];
}

async function checkDbState() {
  const databaseUrl = requireAdminDatabaseUrl();

  const client = postgres(databaseUrl, {
    connect_timeout: 5,
    idle_timeout: 20,
    max: 1,
    prepare: false,
  });

  try {
    console.log("DB state check");
    console.log("Required tables:");

    const tableResults = await Promise.all(
      REQUIRED_TABLES.map(async (tableName) => ({
        tableName,
        exists: await tableExists(client, tableName),
      })),
    );

    for (const result of tableResults) {
      console.log(`- public.${result.tableName}: ${formatExists(result.exists)}`);
    }

    const workspacesExists =
      tableResults.find((result) => result.tableName === "workspaces")
        ?.exists ?? false;
    console.log(`workspaces table: ${formatExists(workspacesExists)}`);

    const workspaceHandleIndexes = await getWorkspaceHandleIndexes(client);
    console.log(
      `unique workspaces(handle): ${formatExists(
        workspaceHandleIndexes.length > 0,
      )}`,
    );

    for (const index of workspaceHandleIndexes) {
      const constraint = index.constraint_name
        ? ` constraint=${index.constraint_name}`
        : "";

      console.log(`- ${index.index_name}${constraint}`);
      console.log(`  ${index.definition}`);
    }

    const migrationTables = await getMigrationTables(client);
    console.log(
      `drizzle migration metadata tables: ${migrationTables.length}`,
    );

    if (migrationTables.length === 0) {
      console.log("- no __drizzle_migrations table found");
    }

    for (const migrationTable of migrationTables) {
      const tableLabel = `${migrationTable.table_schema}.${migrationTable.table_name}`;
      console.log(`- ${tableLabel}`);

      const migrations = await getExecutedMigrations(client, migrationTable);

      if (migrations.length === 0) {
        console.log("  no executed migrations recorded");
        continue;
      }

      for (const migration of migrations) {
        console.log(
          `  id=${migration.id} hash=${migration.hash} created_at=${migration.created_at}`,
        );
      }
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

checkDbState().catch((error: unknown) => {
  logDatabaseError("DB state check failed", error);
  process.exitCode = 1;
});
