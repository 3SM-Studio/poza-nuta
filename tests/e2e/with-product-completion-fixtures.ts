// A test-build-only fault injector. No error hooks or probe routes ship in src.
// The guarded child provisions its own local Supabase/PG17 and sanitizes all env.
import {readFile,writeFile,mkdir,unlink,rmdir,mkdtemp} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {assertNoCloudEnvironmentFiles} from '../../scripts/local-environment-files.ts';
assertNoCloudEnvironmentFiles();
const root=resolve(import.meta.dirname,'../..'),layout=join(root,'src/app/layout.tsx'),route=join(root,'src/app/dev/recovery-fixture'),adminRoute=join(root,'src/app/(platform-admin)/admin/recovery-fixture');
if(existsSync(route)||existsSync(adminRoute))throw new Error('Refuse to replace an existing recovery fixture');
const original=await readFile(layout,'utf8'),marker='export default async function RootLayout({ children }: RootLayoutProps) {';
if(original.split(marker).length!==2)throw new Error('Unexpected root-layout instrumentation target');
const injected=original.replace(marker,marker+`\n  if(process.env.KUNESTU_LOCAL === '1' && (await headers()).get('x-kunestu-test-root-error') === '1')throw new Error('synthetic-recovery-sentinel');`);
const backup=await mkdtemp(join(tmpdir(),'kunestu-recovery-source-'));await writeFile(join(backup,'layout.tsx'),original);
let childExit=1,instrumented=false;
const made:string[]=[];
const fixtureSource=`import {headers} from 'next/headers';import {notFound} from 'next/navigation';export const dynamic='force-dynamic';export default async function Fixture(){if(process.env.KUNESTU_LOCAL!=='1')notFound();if((await headers()).get('x-kunestu-test-segment-error')==='1')throw new Error('synthetic-recovery-sentinel');return <h1>Recovery fixture restored</h1>;}`;
try{
 for(const directory of [route,adminRoute]){await mkdir(directory,{recursive:true});made.push(directory);await writeFile(join(directory,'page.tsx'),fixtureSource);}
 await writeFile(layout,injected);instrumented=true;
 const env={...process.env,LOCAL_E2E_OPTIMIZED:'1',LOCAL_E2E_SEARCH_ENGINE:'unicode-v2',LOCAL_E2E_FAIR_ENGINE:'event-default',LOCAL_E2E_RECOVERY_FIXTURES:'1',LOCAL_E2E_PLAYWRIGHT_GREP:process.argv.includes('--all')?'':process.argv.includes('--collaboration')?'Product completion|Collaborative queue integration':'Product completion'};
 childExit=await new Promise<number>((resolveExit,reject)=>{const child=spawn(process.execPath,['--experimental-strip-types','tests/e2e/run-local-supabase-smoke.ts'],{cwd:root,env,stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('exit',c=>resolveExit(c??1));});
}finally{
 if(instrumented){if(await readFile(layout,'utf8')!==injected)throw new Error('Concurrent layout edit detected. Original retained in '+backup);await writeFile(layout,original);}
 for(const directory of made){if(await readFile(join(directory,'page.tsx'),'utf8')!==fixtureSource)throw new Error('Concurrent fixture edit detected; preserving it');await unlink(join(directory,'page.tsx'));await rmdir(directory);}
 await writeFile(join(root,'.artifacts/product-completion-source-restoration.json'),JSON.stringify({restoredUtc:new Date().toISOString(),sourceRestored:true,layoutSha256:createHash('sha256').update(original).digest('hex'),temporaryRouteRemoved:true,testExit:childExit},null,2)+'\n');
}
process.exitCode=childExit;
