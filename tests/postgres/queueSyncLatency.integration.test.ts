import {test,expect,vi} from 'vitest';
import {createServer,createConnection,type Socket} from 'node:net';
import {randomUUID,randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import * as schema from '../../src/db/schema';
import {createQueueOperation} from '../../src/lib/queue-collaboration';
import {registerPostgresTestPort,unregisterPostgresTestPort} from '../../src/lib/local-target';
import {startPostgresTestHarness,createPostgresTestClient,installPostgresCompatibilityFixture,applyPostgresMigrations,removePostgresTestHarness} from './postgresTestHarness';
vi.mock('server-only',()=>({}));

test('owned PG17 queue phases with measured SQL round trips and a controlled wire delay',async()=>{
 const h=await startPostgresTestHarness('kunestu-p0-latency'),setup=createPostgresTestClient(h,'postgres',1),peers=new Set<Socket>();
 const delay=Number(process.env.LOCAL_QUEUE_WIRE_DELAY_MS??'0');expect([0,90,185]).toContain(delay);
 // Delay server-to-client bytes, not SQL execution or lock holders.
 // Each packet is independently scheduled; pipelined replies are not serialized.
 const proxy=createServer(front=>{const back=createConnection({host:h.host,port:h.port});front.setNoDelay(true);back.setNoDelay(true);peers.add(front);peers.add(back);front.pipe(back);const timers=new Set<ReturnType<typeof setTimeout>>();back.on('data',chunk=>{const timer=setTimeout(()=>{timers.delete(timer);if(!front.destroyed)front.write(chunk);},delay);timers.add(timer);});const close=()=>{timers.forEach(clearTimeout);front.destroy();back.destroy();peers.delete(front);peers.delete(back);};front.on('error',close);back.on('error',close);front.on('close',close);});
 await new Promise<void>(r=>proxy.listen(0,'127.0.0.1',r));const address=proxy.address();if(!address||typeof address==='string')throw new Error('Proxy address');registerPostgresTestPort(address.port);
 const app=postgres({host:'127.0.0.1',port:address.port,username:'postgres',password:h.password,database:'postgres',max:2,prepare:false,onnotice:()=>{},connection:{statement_timeout:6000,idle_in_transaction_session_timeout:7000}});
 const registry=globalThis as typeof globalThis & {pozaNutaDatabase?:ReturnType<typeof import('../../src/server/db')['getDb']>};let statements:string[]=[];let phases:unknown[]=[];
 const log=vi.spyOn(console,'info').mockImplementation(value=>{if(typeof value==='string'&&value.startsWith('{')){const record=JSON.parse(value);if(record.event==='db_telemetry')phases.push({...record,at:performance.now()});}});
 try{
 await installPostgresCompatibilityFixture(setup);await applyPostgresMigrations(setup,36);
 registry.pozaNutaDatabase=drizzle({client:app,schema,logger:{logQuery(query){statements.push(query.replace(/\$\d+/g,'?'));}}});
 const auth=randomUUID(),org='p0latencytest0000001';await setup`insert into auth.users(id) values(${auth})`;const [operator]=await setup`insert into operator_users(name,auth_user_id,password_hash,active) values('Synthetic P0',${auth},'test-only',true) returning id::int`;const [workspace]=await setup`insert into workspaces(public_id,name,handle) values(${org},'P0','p0-latency') returning id::int`;await setup`insert into workspace_members(workspace_id,operator_user_id,role) values(${workspace.id},${operator.id},'owner')`;
 const [event]=await setup`insert into events(workspace_id,name,starts_at,ends_at,status) values(${workspace.id},'P0',now()-interval '1 hour',now()+interval '3 hours','active') returning id::int,public_id`;await setup`insert into event_sessions(event_id,public_token) values(${event.id},${randomBytes(16).toString('base64url')})`;
 const [song]=await setup`insert into songs(source,title,artist,normalized_title,normalized_artist,search_text) values('manual','Synthetic','Synthetic','synthetic','synthetic','synthetic') returning id::int`;const ids:number[]=[];
 for(let i=1;i<=4;i++){const [r]=await setup`insert into song_requests(event_id,song_id,singer_name,display_name,status,position,requested_by) values(${event.id},${song.id},${'Synthetic '+i},${'Synthetic '+i},${i===4?'pending':'approved'},${i===4?0:i},'operator') returning id::int`;ids.push(r.id);}
 const calibration:number[]=[];await app`select ${1}::integer`;for(let i=0;i<5;i++){const start=performance.now();await app`select ${i}::integer`;calibration.push(performance.now()-start);}
 const service=await import('../../src/server/operator-api/queue-sync'),scope={authUserId:auth,organizationId:org,eventId:event.public_id},device=randomUUID(),measures:unknown[]=[];
 let previous:ReturnType<typeof createQueueOperation>;
 for(const action of ['placement','approve','start','done','replay','snapshot'] as const){
  const state=await service.getQueueSyncSnapshot(scope,device,[]),items=state.items.map(x=>({...x,createdAt:x.createdAt.toISOString(),updatedAt:x.updatedAt.toISOString(),startedAt:x.startedAt?.toISOString()??null,completedAt:x.completedAt?.toISOString()??null}));
  const intent=action==='placement'?{kind:'placement' as const,lane:'approved' as const,position:3}: {kind:'action' as const,action:action==='approve'?'approve' as const:action==='start'?'start' as const:'done' as const};
  const op=action==='replay'?previous!:createQueueOperation(items,device,operator.id,state.sortRevision,action==='approve'?ids[3]:ids[0],intent)!;
  statements=[];phases=[];const start=performance.now();const result=action==='snapshot'?await service.getQueueSyncSnapshot(scope,device,[]):await service.applyQueueOperation(scope,op);const first=performance.now()-start;
  if(action==='replay')expect('replayed' in result&&result.replayed).toBe(true);
  measures.push({action,ms:first,sqlCount:statements.length,statements:[...statements],phases:[...phases]});previous=op;
  writeFileSync(`.artifacts/p0-queue-${process.env.LOCAL_QUEUE_LABEL??'baseline'}-${delay}.json`,JSON.stringify({utc:new Date().toISOString(),synthetic:true,delayPerResponseMs:delay,measurements:measures},null,2)+'\n');
  expect(result.items.length).toBe(4);expect(result.items).toEqual((await service.getQueueSyncSnapshot(scope,device,[])).items);
 }
 writeFileSync(`.artifacts/p0-queue-${process.env.LOCAL_QUEUE_LABEL??'baseline'}-${delay}.json`,JSON.stringify({utc:new Date().toISOString(),synthetic:true,delayPerResponseMs:delay,calibration,measurements:measures},null,2)+'\n');
 }finally{log.mockRestore();delete registry.pozaNutaDatabase;await app.end({timeout:1});peers.forEach(p=>p.destroy());await new Promise<void>(r=>proxy.close(()=>r()));unregisterPostgresTestPort(address.port);await setup.end({timeout:5});await removePostgresTestHarness(h.containerName);}
},240000);
