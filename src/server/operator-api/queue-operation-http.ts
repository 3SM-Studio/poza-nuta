import 'server-only';
import type {NextRequest} from 'next/server';
import {parseQueueOperation} from '../../lib/queue-operation';
import {readIdentityBody} from '../session-api/identity-http';
import {OperatorApiError} from './errors';
import {runEventParticipantRoute} from './event-participants-http';
import {validateDashboardEventQueueActionInput,validateDashboardEventQueueMoveInput} from './event-queue-validation';
import {applyQueueOperation} from './queue-sync';
import {validateRequestId} from './validation';

/** Preserve route addresses, but fence old non-conditional writes instead of silently overwriting. */
export function runQueueOperationRoute(request:NextRequest,context:{params:Promise<{organizationId:string;eventId:string;requestId:string}>},kind:'action'|'move'){
  return runEventParticipantRoute(request,context,async scope=>{
    const id=validateRequestId((await context.params).requestId);
    if(!id.success)throw new OperatorApiError(400,'VALIDATION_ERROR','Invalid request identifier.');
    const body=await readIdentityBody(request,4096),operation=parseQueueOperation(body);
    if(!operation){
      const legacy=kind==='action'?validateDashboardEventQueueActionInput(body):validateDashboardEventQueueMoveInput(body);
      if(legacy.success)throw new OperatorApiError(409,'QUEUE_SYNC_REQUIRED','Refresh the operator panel before changing this queue. A versioned operation is required.');
      throw new OperatorApiError(400,'VALIDATION_ERROR','Invalid queue operation.');
    }
    if(operation.requestId!==id.data || (kind==='action'?operation.kind!=='action':operation.kind!=='placement'||operation.lane!=='approved'||operation.expectedStatus!=='approved'))
      throw new OperatorApiError(400,'VALIDATION_ERROR','Operation does not match the route.');
    return applyQueueOperation(scope,operation);
  });
}
