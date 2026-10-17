import 'server-only';
import {performanceHistory} from './performance-history';
import {and,asc,eq,sql} from 'drizzle-orm';
import {alias} from 'drizzle-orm/pg-core';
import {eventParticipants,eventSessions,songRequests,operatorAuditLog} from '../db/schema';
import type {getDb} from './db';
type Reader=Pick<ReturnType<typeof getDb>,'select'>;
const current=alias(eventParticipants,'presentation_canonical');
export async function loadEventPresentation(reader:Reader,eventId:number){
  const rows=await reader.select({id:songRequests.id,status:songRequests.status,completedAt:songRequests.completedAt,requestDisplayName:songRequests.displayName,
    memberId:current.id,currentDisplayName:current.displayName,joinedAt:current.joinedAt,sourceId:eventParticipants.id,
  }).from(songRequests)
    .leftJoin(eventParticipants,eq(eventParticipants.id,songRequests.eventParticipantId))
    .leftJoin(eventSessions,and(eq(eventSessions.id,eventParticipants.eventSessionId),eq(eventSessions.eventId,eventId)))
    .leftJoin(current,and(eq(current.id,sql`coalesce(${eventParticipants.mergedIntoId},${eventParticipants.id})`),eq(current.eventSessionId,eventSessions.id)))
    .where(eq(songRequests.eventId,eventId));
  const audits=await reader.select({id:operatorAuditLog.id,action:operatorAuditLog.action,entityId:operatorAuditLog.entityId,payload:operatorAuditLog.payload,createdAt:operatorAuditLog.createdAt})
    .from(operatorAuditLog).where(and(eq(operatorAuditLog.eventId,eventId),sql`${operatorAuditLog.action} in ('participant_nickname_changed','event_queue_performance_completed','event_queue_approve','event_queue_done','event_queue_start','event_queue_restore')`)).orderBy(asc(operatorAuditLog.id));
  const history=performanceHistory(rows.map(r=>({...r,completedAt:r.completedAt?.getTime()??null})),audits.map(a=>({...a,createdAt:a.createdAt.getTime()})));
  const renames=new Map<number,{before:string;after:string;at:string}[]>();
  for(const audit of audits){
    if(audit.action==='participant_nickname_changed'&&typeof audit.payload?.before==='string'&&typeof audit.payload?.after==='string'){
      const id=Number(audit.entityId),list=renames.get(id)??[];list.push({before:audit.payload.before,after:audit.payload.after,at:audit.createdAt.toISOString()});renames.set(id,list);
    }
  }
  const memberships=await reader.select({id:eventParticipants.id,target:eventParticipants.mergedIntoId}).from(eventParticipants)
    .innerJoin(eventSessions,eq(eventSessions.id,eventParticipants.eventSessionId)).where(eq(eventSessions.eventId,eventId));
  const mergedTargets=new Set<number>();
  for(const member of memberships)if(member.target!==null){mergedTargets.add(member.target);const source=renames.get(member.id);if(source)renames.set(member.target,[...(renames.get(member.target)??[]),...source].sort((a,b)=>a.at.localeCompare(b.at)));}
  const insertions=new Map<number,{reason:string;constrained:boolean}>();
  for(const audit of audits)if(audit.action==='event_queue_approve'){
    insertions.delete(Number(audit.entityId));
    const d=audit.payload?.fairDecision;if(d&&typeof d==='object'&&'reason' in d&&typeof d.reason==='string'&&['first','rotation','protected','separation'].includes(d.reason))insertions.set(Number(audit.entityId),{reason:d.reason,constrained:audit.payload?.constrained===true});
  }
  const counts=new Map<number,number>(),performing=new Set<number>();
  for(const r of rows)if(r.memberId!==null){counts.set(r.memberId,(counts.get(r.memberId)??0)+(history.get(r.id)?.count??0));if(r.status==='now')performing.add(r.memberId);}
  const requests=new Map(rows.map(r=>[r.id,{currentDisplayName:r.currentDisplayName??r.requestDisplayName,requestDisplayName:r.requestDisplayName,
    fairInsertion:insertions.get(r.id),eventParticipantId:r.memberId,completedCount:r.memberId===null?null:counts.get(r.memberId)??0,
    performing:r.memberId!==null&&performing.has(r.memberId),joinedAt:r.joinedAt?.toISOString()??null,
    nicknameChanges:r.memberId===null?[]:renames.get(r.memberId)??[],mergedProfile:r.memberId!==null&&(r.sourceId!==r.memberId||mergedTargets.has(r.memberId)),
  }]));
  const participants=new Map(memberships.filter(m=>m.target===null).map(m=>[m.id,{
    completedCount:counts.get(m.id)??0,performing:performing.has(m.id),
    nicknameChanges:renames.get(m.id)??[],mergedProfile:mergedTargets.has(m.id),
  }]));
  return {requests,participants};
}
export async function loadQueuePresentation(reader:Reader,eventId:number){
  return (await loadEventPresentation(reader,eventId)).requests;
}
export async function presentQueue<T extends {id:number;displayName:string;singerName:string}>(reader:Reader,eventId:number,items:T[]){
  const presentation=await loadQueuePresentation(reader,eventId);
  return items.map(item=>{const meta=presentation.get(item.id);return {...item,...meta,displayName:meta?.currentDisplayName??item.displayName,singerName:meta?.currentDisplayName??item.singerName};});
}
