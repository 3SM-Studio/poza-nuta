import {it,expect,vi} from 'vitest';
import {queueOperationDiagnostic,queueOperationDiagnosticReport} from '../../src/lib/queue-operation-diagnostics';
import {runWithDbTelemetry,bindDbOperationId,getDbTelemetryCorrelation,traceDbOperation,recordSongSearchShape} from '../../src/server/db-telemetry';
const id='00000000-0000-4000-8000-000000000001';
it('bounds records, omits unknown fields and refuses unsafe correlations',()=>{
  const start=queueOperationDiagnosticReport().length;
  queueOperationDiagnostic('local',{scope:'unsafe',requestId:id});expect(queueOperationDiagnosticReport()).toHaveLength(start);
  queueOperationDiagnostic('local',{scope:id,requestId:'secret'});expect(queueOperationDiagnosticReport()).toHaveLength(start);
  const input={scope:id,operationId:id,revision:'2',query:'private',cookie:'private'};
  for(let i=0;i<200;i++)queueOperationDiagnostic('local',input);
  const report=queueOperationDiagnosticReport();expect(report).toHaveLength(128);
  expect(JSON.stringify(report)).not.toContain('private');report[0].scope='mutated';expect(queueOperationDiagnosticReport()[0].scope).toBe(id);
});
it('expires memory records after 30 minutes',()=>{
  const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+31*60_000);
  try{expect(queueOperationDiagnosticReport()).toHaveLength(0);}finally{clock.mockRestore();}
});
it('binds only validated operation IDs within independent async request contexts',async()=>{
  const logs=vi.spyOn(console,'info').mockImplementation(()=>{});
  try{await Promise.all([runWithDbTelemetry('test',async()=>{bindDbOperationId(id);await traceDbOperation('test','safe',async()=>null);expect(getDbTelemetryCorrelation('test').operation_id).toBe(id);}),runWithDbTelemetry('test',async()=>{bindDbOperationId('private');await Promise.resolve();expect(getDbTelemetryCorrelation('test').operation_id).toBeUndefined();})]);
    expect(logs.mock.calls.map(([value])=>JSON.parse(value)).every(x=>x.operation_id===id)).toBe(true);
  }finally{logs.mockRestore();}
});

it('records search shape buckets only and rejects nonfinite shape inputs',()=>{
  const log=vi.spyOn(console,'info').mockImplementation(()=>{});
  try{recordSongSearchShape(33,8,true,true,'unicode-v2');recordSongSearchShape(Infinity,1,false,false,'legacy');
    expect(log).toHaveBeenCalledTimes(1);const result=JSON.parse(log.mock.calls[0][0]);
    expect(result).toMatchObject({length_bucket:'33+',tokens_bucket:'3+',cursor_present:true,fuzzy_eligible:true});
    expect(Object.keys(result).sort()).toEqual(['event','request_id','runtime_id','route','operation','phase','engine','length_bucket','tokens_bucket','cursor_present','fuzzy_eligible'].sort());
  }finally{log.mockRestore();}
});
