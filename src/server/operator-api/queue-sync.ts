import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { events, operatorAuditLog, operatorUsers, queueOperationReceipts, queueStreams } from '../../db/schema';
import { parseQueueOperation, resolveQueueOperationPosition, type QueueOperation } from '../../lib/queue-operation';
import { queuePlacementRevision } from '../../lib/queue-placement';
import { canManageDashboardEventQueue } from '../../lib/dashboard-event-queue';
import { getEffectiveEventLifecycleStatus } from '../../lib/effective-event-lifecycle';
import { getDb } from '../db';
import { setLocalDatabaseTimeouts } from '../database-transaction-timeouts';
import { OperatorApiError } from './errors';
import { getDashboardOrganizationEventForAuthUser } from './organizations';
import { applyDashboardOrganizationEventQueueActionForAuthUser, loadDashboardEventQueueItems, requireEventQueueManagerContext } from './event-queue';

type Scope = { authUserId: string; organizationId: string; eventId: string };
type Transaction = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

async function snapshot(transaction: Transaction, eventId: number, actorId: number, deviceId: string, operationIds: string[]) {
  const [stream] = await transaction.select().from(queueStreams).where(eq(queueStreams.eventId, eventId));
  const [sort] = await transaction.select({ revision: sql<string>`coalesce(max(${operatorAuditLog.id}),0)::text` }).from(operatorAuditLog)
    .where(and(eq(operatorAuditLog.eventId,eventId), eq(operatorAuditLog.action,'event_queue_fair_sort')));
  const acknowledged = operationIds.length ? await transaction.select({ id: queueOperationReceipts.operationId }).from(queueOperationReceipts)
    .where(and(eq(queueOperationReceipts.eventId,eventId),eq(queueOperationReceipts.operatorId,actorId),eq(queueOperationReceipts.deviceId,deviceId),inArray(queueOperationReceipts.operationId,operationIds))) : [];
  return { eventId, actorId, revision: String(stream?.revision ?? 0n), sortRevision: sort.revision,
    items: await loadDashboardEventQueueItems(transaction,eventId), acknowledged: acknowledged.map(x=>x.id) };
}

export async function getQueueSyncSnapshot(scope: Scope, deviceId: string, operationIds: string[]) {
  const context = await getDashboardOrganizationEventForAuthUser(scope);
  if (!context) throw new OperatorApiError(404,'EVENT_NOT_FOUND','Event was not found.');
  return getDb().transaction(async transaction => {
    await setLocalDatabaseTimeouts(transaction);
    const [actor]=await transaction.select({id:operatorUsers.id}).from(operatorUsers).where(eq(operatorUsers.authUserId,scope.authUserId));
    if(!actor)throw new OperatorApiError(403,"WORKSPACE_EVENT_QUEUE_MANAGE_FORBIDDEN","Operator profile is unavailable.");
    const [event]=await transaction.select().from(events).where(and(eq(events.id,context.event.id),eq(events.workspaceId,context.organization.id)));
    if(!event)throw new OperatorApiError(404,'EVENT_NOT_FOUND','Event was not found.');
    return { ...await snapshot(transaction,context.event.id,actor.id,deviceId,operationIds),
      canManage: canManageDashboardEventQueue(context.organization.role), lifecycle: getEffectiveEventLifecycleStatus(event) };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

export async function applyQueueOperation(scope: Scope, rawOperation: QueueOperation) {
  const operation = parseQueueOperation(rawOperation);
  if (!operation) throw new OperatorApiError(400,'VALIDATION_ERROR','Invalid queue operation.');
  return getDb().transaction(async transaction => {
    await setLocalDatabaseTimeouts(transaction);
    // Same lifecycle/session mutex as public requests, legacy actions, merge and Fair Queue.
    const context = await requireEventQueueManagerContext(transaction,scope.authUserId,scope.organizationId,scope.eventId);
    const eventId = context.event.id, actorId = context.organization.operatorId;
    if(operation.actorId!==actorId)throw new OperatorApiError(409,'QUEUE_ACTOR_CHANGED','Sign in as the original operator before retrying this intent.');
    const fingerprint = createHash('sha256').update(JSON.stringify(operation)).digest('hex');
    const [receipt] = await transaction.select().from(queueOperationReceipts)
      .where(and(eq(queueOperationReceipts.eventId,eventId),eq(queueOperationReceipts.operationId,operation.operationId)));
    if (receipt) {
      if (receipt.operatorId !== actorId || receipt.deviceId !== operation.deviceId || receipt.fingerprint !== fingerprint)
        throw new OperatorApiError(409,'QUEUE_OPERATION_REUSED','Operation identifier is already bound to another intent.');
      return { ...await snapshot(transaction,eventId,actorId,operation.deviceId,[operation.operationId]),operationId:operation.operationId,replayed:true };
    }
    const current = await snapshot(transaction,eventId,actorId,operation.deviceId,[]);
    const request = current.items.find(x=>x.id===operation.requestId);
    if (!request) throw new OperatorApiError(404,'REQUEST_NOT_FOUND','The request does not belong to this event.');
    if (request.intentVersion !== operation.expectedIntentVersion || request.status !== operation.expectedStatus)
      throw new OperatorApiError(409,'QUEUE_INTENT_CONFLICT','Another operator changed this request. Review the retained intent.');
    if (operation.kind === 'action' && operation.action === 'start') {
      const now = current.items.find(x=>x.status==='now');
      if ((now?.id ?? null) !== (operation.expectedNow?.id ?? null) ||
        (now && now.intentVersion !== operation.expectedNow?.intentVersion))
        throw new OperatorApiError(409,'QUEUE_PERFORMANCE_CONFLICT','The current performance changed. Review before starting.');
    }
    const placement = operation.kind === 'placement' ? (() => {
      if (operation.sortRevision !== current.sortRevision)
        throw new OperatorApiError(409,'QUEUE_INTENT_CONFLICT','Fair Sort changed the placement context.');
      const position = operation.lane === 'approved' ? resolveQueueOperationPosition(current.items,operation) : 1;
      if (position === null) throw new OperatorApiError(409,'QUEUE_ANCHOR_CONFLICT','A target neighbour moved or is no longer approved.');
      return { lane:operation.lane,position,expectedRevision:queuePlacementRevision(current.items),confirmed:operation.confirmed };
    })() : undefined;
    await applyDashboardOrganizationEventQueueActionForAuthUser({ ...scope,requestId:operation.requestId,
      action:operation.kind==='action' ? operation.action : operation.lane==='approved'?'approve':operation.lane==='pending'?'restore':'reject',placement },transaction);
    // A receipt, domain mutation and its provenance commit together. No HTTP retry can apply twice.
    await transaction.insert(queueOperationReceipts).values({eventId,operatorId:actorId,deviceId:operation.deviceId,
      operationId:operation.operationId,requestId:operation.requestId,fingerprint});
    await transaction.insert(operatorAuditLog).values({eventId,operatorId:actorId,actorKind:'operator',
      action:'event_queue_operation_confirmed',entityId:String(operation.requestId),payload:{operationId:operation.operationId,
        deviceId:operation.deviceId,kind:operation.kind,expectedIntentVersion:operation.expectedIntentVersion,
        ...(operation.kind==='action'?{action:operation.action}:{lane:operation.lane,beforeId:operation.before?.id??null,afterId:operation.after?.id??null})}});
    return { ...await snapshot(transaction,eventId,actorId,operation.deviceId,[operation.operationId]),operationId:operation.operationId,replayed:false };
  });
}
