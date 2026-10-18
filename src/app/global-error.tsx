'use client';
import {StandaloneRecovery} from '@/components/recovery/recovery-boundary';
export default function GlobalError({retry}:{error:Error&{digest?:string};retry:()=>void}){return <StandaloneRecovery retry={retry}/>;}
