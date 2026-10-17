import {randomBytes} from 'node:crypto';
import {expect,it} from 'vitest';
import {applyPostgresMigration,applyPostgresMigrations,createPostgresTestClient,installPostgresCompatibilityFixture,removePostgresTestHarness,startPostgresTestHarness} from './postgresTestHarness';

it('upgrades populated 0032 to 0033 without rewriting requests or inventing past nickname history',async()=>{
 const harness=await startPostgresTestHarness('kunestu-presentation-upgrade'),db=createPostgresTestClient(harness,'postgres',2);
 try{
  await installPostgresCompatibilityFixture(db);await applyPostgresMigrations(db,32);
  const [workspace]=await db`insert into workspaces(name,handle,public_id) values('Synthetic upgrade','synthetic-upgrade',${randomBytes(10).toString('hex')}) returning id`;
  const [event]=await db`insert into events(workspace_id,name,starts_at,ends_at,status) values(${workspace.id},'Synthetic upgrade',now(),now()+interval '4 hours','active') returning id`;
  const [session]=await db`insert into event_sessions(event_id,public_token) values(${event.id},${randomBytes(16).toString('base64url')}) returning id`;
  const [identity]=await db`insert into participant_identities default values returning id`;
  const [member]=await db`insert into event_participants(event_session_id,participant_id,display_name,normalized_display_name) values(${session.id},${identity.id},'Current','current') returning id`;
  const [song]=await db`insert into songs(source,title,artist,normalized_title,normalized_artist,search_text) values('manual','Synthetic','Artist','synthetic','artist','synthetic artist') returning id`;
  await db`insert into song_requests(event_id,song_id,event_participant_id,singer_name,display_name,status,position,requested_by) values(${event.id},${song.id},${member.id},'Original','Original','approved',1,'operator')`;
  const before=await db`select to_jsonb(r) data from song_requests r where event_id=${event.id}`;
  const memberBefore=await db`select to_jsonb(p) data from event_participants p where id=${member.id}`;
  await applyPostgresMigration(db,33);
  expect(await db`select to_jsonb(r) data from song_requests r where event_id=${event.id}`).toEqual(before);
  expect(await db`select to_jsonb(p) data from event_participants p where id=${member.id}`).toEqual(memberBefore);
  await db`update event_participants set display_name=display_name where id=${member.id}`;
  expect((await db`select count(*)::int n from operator_audit_log where action='participant_nickname_changed'`)[0].n).toBe(0);
  const [version]=await db`select intent_version from song_requests where event_id=${event.id}`;
  await db`update event_participants set display_name='Next',normalized_display_name='next' where id=${member.id}`;
  const [audit]=await db`select event_id,payload from operator_audit_log where action='participant_nickname_changed'`;
  expect(Number(audit.event_id)).toBe(Number(event.id));expect(audit.payload).toEqual({before:'Current',after:'Next'});
  expect((await db`select intent_version from song_requests where event_id=${event.id}`)[0]).toEqual(version);
  expect((await db`select display_name,singer_name from song_requests where event_id=${event.id}`)[0]).toEqual({display_name:'Original',singer_name:'Original'});
 }finally{await db.end({timeout:5});await removePostgresTestHarness(harness.containerName);}
});
