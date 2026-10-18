import {RecoveryBoundary} from '@/components/recovery/recovery-boundary';
export function DashboardRuntimeError(props:{title?:string;description?:string;embedded?:boolean}={}){return <RecoveryBoundary kind="unavailable" embedded={props.embedded}/>;}
