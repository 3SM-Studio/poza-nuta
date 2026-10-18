import "server-only";
import {performanceHistory} from "../performance-history";

import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { events, eventParticipants, operatorAuditLog, songRequests } from "../../db/schema";
import type { getDb } from "../db";
import type { FairQueueRequest } from "../fair-queue";
import {admissionBudget} from "../fair-queue-v2";
import {fairEngine} from "../fair-queue-engine";
import { OperatorApiError } from "./errors";

type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function loadFairQueueSnapshot(transaction: Transaction, eventId: number, newlyApproved?: { id: number; at: Date }) {
  const [event] = await transaction.select({engine:events.fairQueueEngine}).from(events).where(eq(events.id,eventId));
  if(!event)throw new OperatorApiError(404,'EVENT_NOT_FOUND','Event was not found.');
  const engine = fairEngine(event.engine);
  const rows = await transaction.select({
    id: songRequests.id, participantId: songRequests.eventParticipantId,
    status: songRequests.status, position: songRequests.position, version: songRequests.version,
    createdAt: songRequests.createdAt, startedAt: songRequests.startedAt, completedAt: songRequests.completedAt,
    mergedIntoId: eventParticipants.mergedIntoId,
  }).from(songRequests).leftJoin(eventParticipants, eq(eventParticipants.id, songRequests.eventParticipantId))
    .where(eq(songRequests.eventId, eventId)).orderBy(asc(songRequests.id));
  const audits = await transaction.select({ id: operatorAuditLog.id, action: operatorAuditLog.action,
    entityId: operatorAuditLog.entityId, payload:operatorAuditLog.payload, createdAt: operatorAuditLog.createdAt }).from(operatorAuditLog)
    .where(and(eq(operatorAuditLog.eventId, eventId), sql`${operatorAuditLog.action} in ('event_queue_approve', 'event_queue_fair_sort', 'event_queue_fair_anchor','event_queue_fair_admission','event_queue_performance_completed','event_queue_performance_cancelled','event_queue_done','event_queue_start','event_queue_restore')`))
    .orderBy(asc(operatorAuditLog.id));
  const approvals = new Map<string, number>();
  const anchors = new Map<string, number>();
  let sortRevision = 0;
  const budgets=new Map<string,number>();
  for (const audit of audits) {
    if (audit.action === "event_queue_approve" && audit.entityId !== null) approvals.set(audit.entityId, audit.createdAt.getTime());
    if (audit.action === "event_queue_fair_anchor" && audit.entityId !== null) anchors.set(audit.entityId, audit.createdAt.getTime());
    if(audit.entityId!==null&&audit.action==='event_queue_fair_admission'){
      const turns=audit.payload?.protectionTurns;if(typeof turns==='number'&&Number.isSafeInteger(turns)&&turns>0)budgets.set(audit.entityId,turns);
    }
    if (audit.action === "event_queue_fair_sort") sortRevision = audit.id;
  }
  const history=performanceHistory(rows.map(r=>({...r,completedAt:r.completedAt?.getTime()??null})),audits.map(a=>({...a,createdAt:a.createdAt.getTime()})));
  const requests: FairQueueRequest[] = rows.map(row => ({
    confirmedCompletions:history.get(row.id)?.times, confirmedCompletionCount:history.get(row.id)?.count, historyObservedAt:history.get(row.id)?.observedAt, protectionTurns:budgets.get(String(row.id)),
    id: row.id, participantId: row.mergedIntoId ?? row.participantId,
    status: row.status, position: row.position, createdAt: row.createdAt.getTime(),
    startedAt: row.startedAt?.getTime() ?? null, completedAt: row.completedAt?.getTime() ?? null,
    approvedAt: newlyApproved?.id === row.id ? newlyApproved.at.getTime() :
      approvals.get(String(row.id)) ?? row.createdAt.getTime(),
    waitingSince: newlyApproved?.id === row.id ? newlyApproved.at.getTime() :
      approvals.get(String(row.id)) ?? anchors.get(String(row.id)) ?? null,
  }));
  if(newlyApproved){const target=requests.find(r=>r.id===newlyApproved.id);if(target){const index=requests.indexOf(target);requests[index]={...target,protectionTurns:admissionBudget(requests,target.id)};}}
  const revision = createHash("sha256").update(JSON.stringify({ engine, eventId, sortRevision,
    requests: requests.map((row, index) => ({ ...row, version: rows[index].version })),
  })).digest("hex");
  return { requests, revision, engine };
}

export async function writeApprovedOrder(transaction: Transaction, eventId: number, snapshot: readonly FairQueueRequest[], order: number[], changedAt: Date, newlyApprovedId?: number) {
  const approved = snapshot.filter(row => row.status === "approved");
  const ids = new Set(order);
  if (ids.size !== order.length || approved.length !== order.length || approved.some(row => !ids.has(row.id))) {
    throw new OperatorApiError(409, "QUEUE_ACTION_CONFLICT", "The approved queue changed.");
  }
  const positions = new Map(order.map((id, index) => [id, index + 1]));
  const changes = approved.filter(row => row.position !== positions.get(row.id)).sort((a, b) => a.id - b.id);
  for (const row of changes) {
    await transaction.update(songRequests).set({
      position: positions.get(row.id)!, updatedAt: changedAt,
      ...(row.id === newlyApprovedId ? {} : { version: sql`${songRequests.version} + 1` }),
    }).where(and(eq(songRequests.id, row.id), eq(songRequests.eventId, eventId), eq(songRequests.status, "approved")));
  }
  return changes.length;
}

// Unknown approval history must never grant waiting credit for time spent
// pending. Record an explicit server observation on the next queue write.
export async function anchorLegacyApprovedRequests(transaction: Transaction, eventId: number, snapshot: readonly FairQueueRequest[], changedAt: Date, operatorId: number) {
  const unbudgeted=snapshot.filter(row=>row.status==='approved'&&row.protectionTurns===undefined);
  if(unbudgeted.length)await transaction.insert(operatorAuditLog).values(unbudgeted.map(row=>({actorKind:'operator' as const,operatorId,eventId,
    action:'event_queue_fair_admission',entityId:String(row.id),createdAt:changedAt,payload:{reason:'observed_legacy_admission',protectionTurns:admissionBudget(snapshot,row.id)},
  })));
  const missing = snapshot.filter(row => row.status === "approved" && row.waitingSince === null);
  if (missing.length) await transaction.insert(operatorAuditLog).values(missing.map(row => ({
    actorKind: "operator" as const, operatorId, eventId, action: "event_queue_fair_anchor",
    entityId: String(row.id), createdAt: changedAt, payload: { reason: "approval_history_unavailable" },
  })));
}
