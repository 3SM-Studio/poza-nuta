'use client';
import {RecoveryBoundary} from '@/components/recovery/recovery-boundary';
export function AdminErrorState({reset,embedded=true}:{reset:()=>void;embedded?:boolean}){return <RecoveryBoundary retry={reset} embedded={embedded}/>;}
