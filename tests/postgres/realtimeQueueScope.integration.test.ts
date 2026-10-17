import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'vitest';
import {applyPostgresMigration,applyPostgresMigrations,createPostgresTestClient,installPostgresCompatibilityFixture,removePostgresTestHarness,startPostgresTestHarness} from './postgresTestHarness';

test('0035 fences actual Realtime SELECT by event membership without granting broadcast writes',async()=>{
 const harness=await startPostgresTestHarness('kunestu-realtime-scope'),db=createPostgresTestClient(harness,'postgres',2);
 try{
  await installPostgresCompatibilityFixture(db);await applyPostgresMigrations(db,34);
  await db.unsafe(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   create or replace function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true) $$;
   grant usage on schema realtime to authenticated,anon; grant select,insert on realtime.messages to authenticated,anon;
   insert into realtime.messages(extension) values('broadcast'),('presence');`);
  const uid=randomUUID();await db`insert into auth.users(id) values(${uid})`;
  const [actor]=await db`insert into operator_users(name,auth_user_id,password_hash) values('Synthetic scope actor',${uid},'test-only') returning id`;
  const groups=[];
  for(let i=0;i<2;i++){
   const [w]=await db`insert into workspaces(name,handle,public_id) values('Synthetic scope',${'scope-'+randomUUID()},${randomBytes(10).toString('hex')}) returning id`;
   const [e]=await db`insert into events(workspace_id,name,starts_at,ends_at,status) values(${w.id},'Synthetic scope',now(),now()+interval '4 hour','active') returning id`;
   groups.push({workspace:w.id,event:e.id});
  }
  await db`insert into workspace_members(workspace_id,operator_user_id,role) values(${groups[0].workspace},${actor.id},'operator')`;
  async function reads(topic:string,anonymous=false){return db.begin(async tx=>{
   await tx`select set_config('request.jwt.claim.sub',${uid},true),set_config('realtime.topic',${topic},true)`;
   if(anonymous)await tx`set local role anon`;else await tx`set local role authenticated`;
   return (await tx`select count(*)::int n from realtime.messages`)[0].n;
  });}
  const own=`dashboard:event:${groups[0].event}:queue`,other=`dashboard:event:${groups[1].event}:queue`;
  assert.equal(await reads(other),1,'reproduce legacy cross-organization signal exposure');
  await applyPostgresMigration(db,35);
  assert.equal(await reads(own),1);assert.equal(await reads(other),0);assert.equal(await reads(own,true),0);
  for(const topic of ['dashboard:event:abc:queue',own+':extra','dashboard:event:999999999999999999999999999999:queue'])assert.equal(await reads(topic),0);
  assert.equal(await reads(`dashboard:event:${groups[0].event}:participants`),1);
  assert.equal(await reads(`dashboard:event:${groups[1].event}:participants`),0);
  assert.equal(await reads('public:session:abcdefghijklmnopqrstuv:queue',true),1,'public capability topic retained');
  await assert.rejects(db.begin(async tx=>{await tx`select set_config('request.jwt.claim.sub',${uid},true),set_config('realtime.topic',${own},true)`;await tx`set local role authenticated`;await tx`insert into realtime.messages(extension) values('broadcast')`;}),e=>typeof e==='object'&&e!==null&&'code' in e&&e.code==='42501');
  for(const role of ['viewer','manager','owner','operator']){
   await db`update workspace_members set role=${role} where operator_user_id=${actor.id}`;assert.equal(await reads(own),1);
  }
  await db`update workspace_members set active=false where operator_user_id=${actor.id}`;assert.equal(await reads(own),0);
  await db`update workspace_members set active=true where operator_user_id=${actor.id}`;
  await db`update workspaces set active=false where id=${groups[0].workspace}`;assert.equal(await reads(own),0);
  await db`update workspaces set active=true where id=${groups[0].workspace}`;
  await db`update operator_users set active=false where id=${actor.id}`;assert.equal(await reads(own),0);
  await db`update operator_users set active=true,suspended_at=now(),suspension_reason='Synthetic',suspended_by_operator_id=${actor.id} where id=${actor.id}`;assert.equal(await reads(own),0);
  await db`update operator_users set suspended_at=null,suspension_reason=null,suspended_by_operator_id=null where id=${actor.id}`;assert.equal(await reads(own),1);
  const exposed=await db`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and (not c.relrowsecurity or has_table_privilege('anon',c.oid,'SELECT') or has_table_privilege('authenticated',c.oid,'SELECT'))`;
  assert.deepEqual(Array.from(exposed),[]);
 }finally{await db.end({timeout:5});await removePostgresTestHarness(harness.containerName);}
});
