import {it,expect} from 'vitest';
import {createPostgresTestClient,installPostgresCompatibilityFixture,startPostgresTestHarness,removePostgresTestHarness,applyPostgresMigrations,applyPostgresMigration} from './postgresTestHarness';
it('0036 pins existing events to legacy, defaults new events to v2 and preserves queue/history',async()=>{
 const h=await startPostgresTestHarness('kunestu-event-engine'),db=createPostgresTestClient(h,'postgres',1);
 try{
  await installPostgresCompatibilityFixture(db);await applyPostgresMigrations(db,35);
  const [w]=await db`insert into workspaces(name,handle,public_id) values('Synthetic','synthetic-engine','syntheticengine00001') returning id`;
  const [e]=await db`insert into events(workspace_id,name,starts_at,ends_at,status) values(${w.id},'Existing live',now(),now()+interval '4 hours','active') returning id`;
  const [s]=await db`insert into songs(source,title,artist,normalized_title,normalized_artist,search_text) values('manual','Synthetic','Synthetic','synthetic','synthetic','synthetic') returning id`;
  await db`insert into song_requests(event_id,song_id,singer_name,display_name,status,position,requested_by) values(${e.id},${s.id},'Synthetic','Synthetic','approved',1,'operator'),(${e.id},${s.id},'History','History','done',0,'operator')`;
  const before=await db`select md5(string_agg(row_to_json(r)::text,'' order by id)) digest from song_requests r`;
  await applyPostgresMigration(db,36);
  expect((await db`select fair_queue_engine from events where id=${e.id}`)[0].fair_queue_engine).toBe('legacy');
  const [fresh]=await db`insert into events(workspace_id,name,starts_at,ends_at) values(${w.id},'New',now(),now()+interval '4 hours') returning fair_queue_engine`;
  expect(fresh.fair_queue_engine).toBe('rotation-v2');
  expect(await db`select md5(string_agg(row_to_json(r)::text,'' order by id)) digest from song_requests r`).toEqual(before);
  await expect(db`update events set fair_queue_engine='unknown' where id=${e.id}`).rejects.toMatchObject({code:'23514'});
  expect((await db`select count(*)::int n from events where fair_queue_engine is null`)[0].n).toBe(0);
 }finally{await db.end({timeout:5});await removePostgresTestHarness(h.containerName);}
},120000);
