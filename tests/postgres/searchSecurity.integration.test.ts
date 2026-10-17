import assert from "node:assert/strict";
import { test } from "vitest";
import { applyPostgresMigrations, createPostgresTestClient, installPostgresCompatibilityFixture, removePostgresTestHarness, startPostgresTestHarness } from "./postgresTestHarness.ts";

test("backend-only tables and event-trigger grant reduction remain closed on owned PG17", async () => {
  const harness = await startPostgresTestHarness("kunestu-search-security");
  const db = createPostgresTestClient(harness, "postgres", 1);
  try {
    await installPostgresCompatibilityFixture(db); await applyPostgresMigrations(db, 33);
    const exposed = await db`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and
      (not c.relrowsecurity or has_table_privilege('anon',c.oid,'SELECT') or has_table_privilege('authenticated',c.oid,'SELECT'))`;
    assert.deepEqual(Array.from(exposed), [], "business tables must remain RLS-enabled with no browser SELECT grants");
    // This is an explicitly synthetic analogue, not the unseen hosted function.
    await db.unsafe(`create function public.reliability_rls_fixture() returns event_trigger
      language plpgsql security definer set search_path=pg_catalog as $$
      declare command record; begin
        for command in select * from pg_event_trigger_ddl_commands() loop
          if command.object_type='table' and command.schema_name='public' then
            execute format('alter table %s enable row level security',command.objid::regclass);
          end if;
        end loop;
      end $$`);
    assert.equal((await db`select has_function_privilege('anon','public.reliability_rls_fixture()','EXECUTE') allowed`)[0].allowed, true);
    await assert.rejects(db.begin(async tx => {
      await tx`set local role anon`; await tx`select public.reliability_rls_fixture()`;
    }), (error: unknown) => typeof error==='object' && error!==null && 'code' in error && error.code==='0A000');
    await db`revoke execute on function public.reliability_rls_fixture() from public, anon, authenticated`;
    assert.equal((await db`select has_function_privilege('anon','public.reliability_rls_fixture()','EXECUTE') allowed`)[0].allowed, false);
    await assert.rejects(db.begin(async tx => {
      await tx`set local role authenticated`; await tx`select public.reliability_rls_fixture()`;
    }), (error: unknown) => typeof error==='object' && error!==null && 'code' in error && error.code==='42501');
    await db.unsafe(`create event trigger reliability_rls_fixture on ddl_command_end when tag in ('CREATE TABLE') execute function public.reliability_rls_fixture()`);
    await db`create table public.reliability_rls_probe(id integer)`;
    assert.equal((await db`select relrowsecurity from pg_class where oid='public.reliability_rls_probe'::regclass`)[0].relrowsecurity, true);
    // No broad browser policy is added to silence an advisor.
    assert.equal((await db`select count(*)::int as n from pg_policies where schemaname='public' and tablename='reliability_rls_probe'`)[0].n, 0);
  } finally { await db.end({timeout:5}); await removePostgresTestHarness(harness.containerName); }
});
