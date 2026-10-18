'use client';
import {RecoveryBoundary} from '@/components/recovery/recovery-boundary';
export default function PublicEventError({retry}:{error:Error&{digest?:string};retry:()=>void}){return <RecoveryBoundary retry={retry}/>;}
