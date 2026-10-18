import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { events, operatorAuditLog, operatorUsers, queueOperationReceipts, queueStreams, songRequests, workspaces, workspaceMembers } from '../../db/schema';
import { isOrganizationPublicId } from '../../lib/organization-public-id';
import { parseDashboardEventIdentifier } from '../../lib/dashboard-event-identifier';
import { parseQueueOperation, resolveQueueOperationPosition, type QueueOperation } from '../../lib/queue-operation';
import { queuePlacementRevision } from '../../lib/queue-placement';
import { canManageDashboardEventQueue } from '../../lib/dashboard-event-queue';
import { getEffectiveEventLifecycleStatus } from '../../lib/effective-event-lifecycle';
import { getDb } from '../db';
import { setLocalDatabaseTimeouts } from '../database-transaction-timeouts';
import { OperatorApiError } from './errors';
import {traceDbOperation,traceDbTransaction} from '../db-telemetry';
import { applyDashboardOrganizationEventQueueActionForAuthUser, loadDashboardEventQueueItems, requireEventQueueManagerContext } from './event-queue';

type Scope = { authUserId: string; organizationId: string; eventId: string };
type Transaction = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

async function snapshot(transaction: Transaction, eventId: number, actorId: number, deviceId: string, operationIds: string[], canonicalItems?:Awaited<ReturnType<typeof loadDashboardEventQueueItems>>) {
  const [metadata] = await transaction.execute<{revision:string;sortRevision:string;acknowledged:string[]}>(sql`select
    coalesce((select ${queueStreams.revision}::text from ${queueStreams} where ${queueStreams.eventId}=${eventId}),'0') as revision,
    ${sortRevisionSql(eventId)} as "sortRevision",
    ${operationIds.length ? sql`coalesce((select array_agg(${queueOperationReceipts.operationId}::text) from ${queueOperationReceipts}
      where ${queueOperationReceipts.eventId}=${eventId} and ${queueOperationReceipts.operatorId}=${actorId}
      and ${queueOperationReceipts.deviceId}=${deviceId} and ${inArray(queueOperationReceipts.operationId,operationIds)}),array[]::text[])` : sql`array[]::text[]`} as acknowledged`);
  return {eventId,actorId,...metadata,items:canonicalItems??await loadDashboardEventQueueItems(transaction,eventId)};
}

function sortRevisionSql(eventId:number){
  return sql`(select coalesce(max(${operatorAuditLog.id}),0)::text from ${operatorAuditLog}
    where ${operatorAuditLog.eventId}=${eventId} and ${operatorAuditLog.action}='event_queue_fair_sort')`;
}

export async function getQueueSyncSnapshot(scope: Scope, deviceId: string, operationIds: string[]) {
  const identifier=parseDashboardEventIdentifier(scope.eventId);
  if(!identifier||!isOrganizationPublicId(scope.organizationId))throw new OperatorApiError(404,'EVENT_NOT_FOUND','Event was not found.');
  return traceDbTransaction('operator.queue.sync','queue.sync.transaction',onStarted=>getDb().transaction(async transaction => {
    onStarted();
    await setLocalDatabaseTimeouts(transaction);
    // Authorization and lifecycle belong to the same repeatable-read snapshot.
    // Preserve all active-profile/workspace/membership predicates, including viewers.
    const [context]=await transaction.select({event:events,actorId:operatorUsers.id,role:workspaceMembers.role}).from(events)
      .innerJoin(workspaces,eq(workspaces.id,events.workspaceId))
      .innerJoin(workspaceMembers,eq(workspaceMembers.workspaceId,workspaces.id))
      .innerJoin(operatorUsers,eq(operatorUsers.id,workspaceMembers.operatorUserId))
      .where(and(eq(events.publicId,identifier.value),eq(workspaces.publicId,scope.organizationId),
        eq(workspaces.active,true),eq(workspaceMembers.active,true),eq(operatorUsers.active,true),eq(operatorUsers.authUserId,scope.authUserId))).limit(1);
    if(!context)throw new OperatorApiError(404,'EVENT_NOT_FOUND','Event was not found.');
    return { ...await snapshot(transaction,context.event.id,context.actorId,deviceId,operationIds),
      canManage: canManageDashboardEventQueue(context.role), lifecycle: getEffectiveEventLifecycleStatus(context.event) };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' }));
}

export async function applyQueueOperation(scope: Scope, rawOperation: QueueOperation) {
  const operation = parseQueueOperation(rawOperation);
  if (!operation) throw new OperatorApiError(400,'VALIDATION_ERROR','Invalid queue operation.');
  return traceDbTransaction('operator.queue.sync','queue.sync.transaction',onStarted=>getDb().transaction(async transaction => {
    onStarted();
    await setLocalDatabaseTimeouts(transaction);
    // Same lifecycle/session mutex as public requests, legacy actions, merge and Fair Queue.
    const context = await traceDbOperation('operator.queue.sync','queue.sync.authorize_and_lock',()=>requireEventQueueManagerContext(transaction,scope.authUserId,scope.organizationId,scope.eventId));
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
    // Intent validation needs versions and placement only, not names/history/song
    // presentation. The event mutex remains held through validation and mutation.
    const intentRows=await traceDbOperation('operator.queue.sync','queue.sync.initial_snapshot',()=>transaction.select({
      id:songRequests.id,status:songRequests.status,position:songRequests.position,
      version:songRequests.version,intentVersion:songRequests.intentVersion,sortRevision:sortRevisionSql(eventId).mapWith(String),
    }).from(songRequests).where(eq(songRequests.eventId,eventId)));
    const current={items:intentRows,sortRevision:intentRows[0]?.sortRevision??'0'};
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
    const mutation=await traceDbOperation('operator.queue.sync','queue.sync.mutation',()=>applyDashboardOrganizationEventQueueActionForAuthUser({ ...scope,requestId:operation.requestId,
      action:operation.kind==='action' ? operation.action : operation.lane==='approved'?'approve':operation.lane==='pending'?'restore':'reject',placement },transaction,context));
    // A receipt, domain mutation and its provenance commit together. No HTTP retry can apply twice.
    await traceDbOperation('operator.queue.sync','queue.sync.receipt_and_audit',()=>Promise.all([transaction.insert(queueOperationReceipts).values({eventId,operatorId:actorId,deviceId:operation.deviceId,
      operationId:operation.operationId,requestId:operation.requestId,fingerprint}),
    transaction.insert(operatorAuditLog).values({eventId,operatorId:actorId,actorKind:'operator',
      action:'event_queue_operation_confirmed',entityId:String(operation.requestId),payload:{operationId:operation.operationId,
        deviceId:operation.deviceId,kind:operation.kind,expectedIntentVersion:operation.expectedIntentVersion,
        ...(operation.kind==='action'?{action:operation.action}:{lane:operation.lane,beforeId:operation.before?.id??null,afterId:operation.after?.id??null})}})]));
    return { ...await traceDbOperation('operator.queue.sync','queue.sync.final_snapshot',()=>snapshot(transaction,eventId,actorId,operation.deviceId,[operation.operationId],mutation.items)),operationId:operation.operationId,replayed:false };
  }));
}
