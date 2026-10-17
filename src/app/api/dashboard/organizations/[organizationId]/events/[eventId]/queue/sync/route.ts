import type { NextRequest } from 'next/server';
import { isQueueOperationId, parseQueueOperation } from '@/lib/queue-operation';
import { runEventParticipantRoute } from '@/server/operator-api/event-participants-http';
import { OperatorApiError } from '@/server/operator-api/errors';
import { applyQueueOperation, getQueueSyncSnapshot } from '@/server/operator-api/queue-sync';
import { readIdentityBody } from '@/server/session-api/identity-http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Context = { params: Promise<{ organizationId:string; eventId:string }> };
export async function GET(request: NextRequest,context: Context) {
  return runEventParticipantRoute(request,context,async scope=>{
    const url = new URL(request.url), deviceId=url.searchParams.get('deviceId'), ids=url.searchParams.getAll('operationId');
    if (!isQueueOperationId(deviceId) || ids.length>64 || ids.some(id=>!isQueueOperationId(id)))
      throw new OperatorApiError(400,'VALIDATION_ERROR','Invalid queue synchronisation request.');
    return getQueueSyncSnapshot(scope,deviceId,ids);
  });
}
export async function POST(request: NextRequest,context: Context) {
  return runEventParticipantRoute(request,context,async scope=>{
    const operation=parseQueueOperation(await readIdentityBody(request,4096));
    if (!operation) throw new OperatorApiError(400,'VALIDATION_ERROR','Invalid queue operation.');
    return applyQueueOperation(scope,operation);
  });
}
