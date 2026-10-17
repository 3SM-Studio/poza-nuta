import {NextRequest} from 'next/server';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {OperatorApiError} from '@/server/operator-api/errors';
const m=vi.hoisted(()=>({session:vi.fn(),apply:vi.fn(),snapshot:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/server/operator-api/supabase-session',()=>({requireOperatorSession:m.session}));
vi.mock('@/server/operator-api/queue-sync',()=>({applyQueueOperation:m.apply,getQueueSyncSnapshot:m.snapshot}));
import {GET,POST} from '@/app/api/dashboard/organizations/[organizationId]/events/[eventId]/queue/sync/route';
import {POST as actionPOST} from '@/app/api/dashboard/organizations/[organizationId]/events/[eventId]/queue/requests/[requestId]/action/route';
import {POST as movePOST} from '@/app/api/dashboard/organizations/[organizationId]/events/[eventId]/queue/requests/[requestId]/move/route';
const origin='http://localhost:3105',eventId='a1000000-0000-4000-8000-000000000001';
const ctx={params:Promise.resolve({organizationId:'organizationtest0001',eventId})};
const op={operationId:'a1000000-0000-4000-8000-000000000002',deviceId:'a1000000-0000-4000-8000-000000000003',actorId:1,requestId:1,expectedIntentVersion:0,expectedStatus:'pending',sortRevision:'0',kind:'action',action:'approve',expectedNow:null};
function request(body:unknown,headers:Record<string,string>={}){return new NextRequest(origin+'/api/dashboard/organizations/organizationtest0001/events/'+eventId+'/queue/sync',{method:'POST',headers:{origin,host:'localhost:3105','content-type':'application/json',...headers},body:JSON.stringify(body)});}
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('SITE_URL',origin);m.session.mockResolvedValue({authUser:{id:'verified-auth-user'}});});
afterEach(()=>vi.unstubAllEnvs());
it('passes the authenticated identity separately from the correlation actor and returns an uncached snapshot',async()=>{
  m.apply.mockResolvedValue({revision:'10',acknowledged:[op.operationId],items:[]});const r=await POST(request(op),ctx);
  expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');
  expect(m.apply).toHaveBeenCalledExactlyOnceWith({authUserId:'verified-auth-user',organizationId:'organizationtest0001',eventId},op);
});
it('rejects CSRF, non-JSON and missing authentication before mutation',async()=>{
  expect((await POST(request(op,{origin:'https://foreign.invalid'}),ctx)).status).toBe(403);
  expect((await POST(request(op,{'content-type':'text/plain'}),ctx)).status).toBe(415);
  m.session.mockRejectedValue(new OperatorApiError(401,'AUTH_REQUIRED','Sign in.'));expect((await POST(request(op),ctx)).status).toBe(401);expect(m.apply).not.toHaveBeenCalled();
});
it('rejects unbounded input, forged authority, unsafe IDs and invalid neighbours',async()=>{
  for(const bad of [{...op,role:'owner'},{...op,requestId:0},{...op,deviceId:'guess'},{...op,sortRevision:'Infinity'},{...op,payload:'x'.repeat(5000)},{...op,action:['approve']},{...op,expectedStatus:['pending']}])expect((await POST(request(bad),ctx)).status).toBe(400);
  expect(m.apply).not.toHaveBeenCalled();
});
it('limits and validates receipt requests while deriving actor scope on the server',async()=>{
  const url=origin+'/api/dashboard/organizations/organizationtest0001/events/'+eventId+'/queue/sync';m.snapshot.mockResolvedValue({items:[],revision:'3'});
  expect((await GET(new NextRequest(url+'?deviceId='+op.deviceId+'&operationId='+op.operationId),ctx)).status).toBe(200);
  expect(m.snapshot).toHaveBeenCalledWith({authUserId:'verified-auth-user',organizationId:'organizationtest0001',eventId},op.deviceId,[op.operationId]);
  m.snapshot.mockClear();for(const suffix of ['?deviceId=bad','?deviceId='+op.deviceId+'&operationId=x','?deviceId='+op.deviceId+('&operationId='+op.operationId).repeat(65)])expect((await GET(new NextRequest(url+suffix),ctx)).status).toBe(400);
  expect(m.snapshot).not.toHaveBeenCalled();
});
it.each(['QUEUE_INTENT_CONFLICT','QUEUE_ANCHOR_CONFLICT','QUEUE_PERFORMANCE_CONFLICT','QUEUE_ACTOR_CHANGED'])('exposes a safe %s without leaking a database error',async code=>{
  m.apply.mockRejectedValue(new OperatorApiError(409,code,'Review your retained change.'));const r=await POST(request(op),ctx);expect(r.status).toBe(409);expect((await r.json()).error.code).toBe(code);
});
it('fences old unconditioned action and move requests instead of bypassing concurrent-operation safety',async()=>{
  const legacyContext={params:Promise.resolve({organizationId:'organizationtest0001',eventId,requestId:'1'})};
  for(const [handler,body] of [[actionPOST,{action:'start'}],[movePOST,{direction:'up'}]] as const){
    const result=await handler(request(body),legacyContext);expect(result.status).toBe(409);
    expect((await result.json()).error.code).toBe('QUEUE_SYNC_REQUIRED');
  }
  expect(m.apply).not.toHaveBeenCalled();
});
it('binds a versioned compatibility request to its route and preserves authenticated server scope',async()=>{
  const legacyContext={params:Promise.resolve({organizationId:'organizationtest0001',eventId,requestId:'1'})};
  m.apply.mockResolvedValue({revision:'11',acknowledged:[op.operationId],items:[]});
  expect((await actionPOST(request(op),legacyContext)).status).toBe(200);
  expect((await actionPOST(request({...op,requestId:2}),legacyContext)).status).toBe(400);
  expect((await movePOST(request(op),legacyContext)).status).toBe(400);
  expect(m.apply).toHaveBeenCalledTimes(1);
});
