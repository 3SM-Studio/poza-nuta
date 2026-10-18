// Test-build-only render counters. Always restore exact bytes; never ship probes.
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {assertNoCloudEnvironmentFiles} from '../../scripts/local-environment-files.ts';
assertNoCloudEnvironmentFiles();
const root=resolve(import.meta.dirname,'../..'),label=process.argv[2];
if(!['fa9-baseline','candidate'].includes(label))throw new Error('Expected a bounded profile label');
const targets=[
  {path:'src/components/operator/event-queue-panel.tsx',markers:[['const tx=useUiText();','panel'],['}: EventQueueRequestRowProps) {','row']]},
  {path:'src/components/operator/queue-drag-board.tsx',markers:[['export function QueueDragBoard({ id, generation, items, canDrag, onDraggingChange, onDrop, renderRow }: Props) {','board'],['const DraggableRow = memo(function DraggableRow(','draggable']]},
];
const backup=await mkdtemp(join(tmpdir(),'kunestu-queue-profile-')),changed:{path:string;original:Buffer;injected:Buffer}[]=[];
await mkdir(join(root,'.artifacts'),{recursive:true});let code=1;
try{
 for(const target of targets){const path=join(root,target.path),original=await readFile(path);let source=original.toString('utf8');
  for(const [marker,name] of target.markers){
   if(source.split(marker).length!==2)throw new Error('Unexpected instrumentation target: '+name);
   const start=source.indexOf(marker),at=name==='draggable'?source.indexOf('\n',start):start+marker.length;
   source=source.slice(0,at)+`\n  if(typeof window!=='undefined')performance.mark('p0:${name}');`+source.slice(at);
  }
  await writeFile(join(backup,target.path.split('/').at(-1)!),original);
  const injected=Buffer.from(source);await writeFile(path,injected);changed.push({path,original,injected});
 }
 code=await new Promise<number>((done,reject)=>{const child=spawn(process.execPath,['--experimental-strip-types','tests/e2e/run-local-supabase-smoke.ts'],{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,LOCAL_E2E_OPTIMIZED:'1',LOCAL_E2E_SEARCH_ENGINE:'unicode-v2',LOCAL_E2E_FAIR_ENGINE:'event-default',LOCAL_E2E_PLAYWRIGHT_GREP:'performance (20|50|100)',LOCAL_E2E_P0_PROFILE:'1',LOCAL_E2E_PROFILE_LABEL:label}});child.on('error',reject);child.on('exit',value=>done(value??1));});
}finally{
 for(const file of changed){if(!(await readFile(file.path)).equals(file.injected))throw new Error('Concurrent edit; preserved original in '+backup);await writeFile(file.path,file.original);}
 await writeFile(join(root,`.artifacts/p0-final-mile-${label}-source-restoration.json`),JSON.stringify({utc:new Date().toISOString(),exit:code,files:changed.map(f=>({path:f.path,sha256:createHash('sha256').update(f.original).digest('hex')})),restored:true}));
}
process.exitCode=code;
