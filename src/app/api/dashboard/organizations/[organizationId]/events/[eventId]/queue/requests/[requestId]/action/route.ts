import type {NextRequest} from 'next/server';
import {runWithDbTelemetry} from '@/server/db-telemetry';
import {runQueueOperationRoute} from '@/server/operator-api/queue-operation-http';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function POST(request:NextRequest,context:{params:Promise<{organizationId:string;eventId:string;requestId:string}>}){
  return runWithDbTelemetry('operator.queue.action',()=>runQueueOperationRoute(request,context,'action'));
}
