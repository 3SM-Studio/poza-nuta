"use client";

import Link from "next/link";
import { useUiText } from "@/i18n/use-ui-text";
import { localizeUiRecord } from "@/i18n/text";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleCheck,
  CircleDot,
  LockKeyhole,
  Mic2,
  RefreshCw,
  RotateCcw,
  WifiOff,
  X,
} from "lucide-react";


import { RequestStatusBadge } from "@/components/request-status-badge";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  CardDescription,
} from "@/components/ui/card";
import type { DashboardEventLifecycleStatus } from "@/lib/dashboard-event-lifecycle";
import {
  canApplyDashboardEventQueueAction,
  type DashboardEventQueueAction,
  type DashboardEventQueueMoveDirection,
  type DashboardEventQueueRequestStatus,
} from "@/lib/dashboard-event-queue";
import type { QueueRealtimeConnectionStatus } from '@/lib/queue-realtime';
import { createQueueOperation } from '@/lib/queue-collaboration';
import type { QueueOperation } from '@/lib/queue-operation';
import { useQueueCollaboration } from './use-queue-collaboration';
import { formatWarsawDateTime } from "@/lib/warsaw-time";

import { formatDuration } from "./api";
import type { DashboardEventQueueItemDto } from './event-queue-api';
import { useDashboardQueueRealtime } from "./use-dashboard-queue-realtime";
import { FairQueueControl } from "./fair-queue-control";
import { QueueDragBoard, QueueDragNotice } from "./queue-drag-board";
import { type QueueDropInput } from "@/lib/queue-placement";

const actionLabels: Record<DashboardEventQueueAction, string> = {
  approve: "Zaakceptuj",
  start: "Rozpocznij występ",
  reject: "Odrzuć",
  done: "Oznacz jako zagrane",
  restore: "Przywróć",
};

const destructiveButtonClassName =
  "border-destructive bg-destructive text-background hover:bg-destructive hover:brightness-95 focus-visible:border-destructive focus-visible:ring-destructive/35 disabled:border-border disabled:bg-muted disabled:text-foreground disabled:opacity-100";

type EventQueuePanelProps = {
  organizationId: string;
  eventId: string;
  realtimeEventId: number;
  canManage: boolean;
  lifecycle: DashboardEventLifecycleStatus;
  publicQueueEnabled: boolean;
  initialItems: DashboardEventQueueItemDto[];
};

export function EventQueuePanel({ organizationId,eventId,realtimeEventId,canManage,lifecycle,publicQueueEnabled,initialItems }:EventQueuePanelProps) {
  const tx=useUiText();
  const {client,state,deviceId}=useQueueCollaboration(organizationId,eventId,initialItems);
  const items=state.items;
  const [dragActive,setDragActive]=useState(false),[dragEpoch,setDragEpoch]=useState(0);
  const dragActiveRef=useRef(false),dragEpochRef=useRef(0),gestureRevision=useRef('');
  const [dragNotice,setDragNotice]=useState<string|null>(null);
  const [pendingReject,setPendingReject]=useState<{requestId:number;placement:QueueDropInput}|null>(null);
  const rejectionOperationRef=useRef<QueueOperation|null>(null),rejectionFocusRequestRef=useRef<number|null>(null);
  const [fairQueueBusy,setFairQueueBusy]=useState(false);
  const queuePanelRef=useRef<HTMLElement|null>(null);
  const pendingMutationCount=state.entries.length;
  const queueClosedDetected=state.closed;
  const canMutate=canManage&&lifecycle==='active'&&!state.closed&&state.ready&&!pendingReject;
  const isRefreshing=false,isSyncing=false,placementBusy=false;
  const error=state.error,errorSource=error?'refresh':null;
  const currentItem=items.find(x=>x.status==='now')??null;
  const approvedItems=items.filter(x=>x.status==='approved').sort((a,b)=>a.position-b.position||a.id-b.id);
  const closedItems=items.filter(x=>x.status==='done'||x.status==='skipped');
  const refreshFromRealtime=useCallback(async()=>{await client?.refresh();},[client]);
  const liveStatus=useDashboardQueueRealtime(realtimeEventId,refreshFromRealtime,client?.getRevision);
  const scheduleQueueRequestFocus=useCallback((id:number)=>requestAnimationFrame(()=>{
    queuePanelRef.current?.querySelector<HTMLElement>(`[data-queue-request-id="${id}"]`)?.focus({preventScroll:true});
  }),[]);
  useEffect(()=>client?.subscribe(()=>{
    if(dragActiveRef.current&&gestureRevision.current!==queueGestureRevision(client.getSnapshot().items)){
      dragActiveRef.current=false;setDragActive(false);dragEpochRef.current++;setDragEpoch(dragEpochRef.current);
      setDragNotice('Kolejka została zaktualizowana. Przeciągnij zgłoszenie ponownie.');
    }
  }),[client]);
  function enqueue(requestId:number,intent:Parameters<typeof createQueueOperation>[5]){
    const actor=client?.getActorId();if(!client||!actor||!canMutate)return;
    const snapshot=client.getSnapshot();const op=createQueueOperation(snapshot.items,deviceId,actor,snapshot.sortRevision,requestId,intent);
    if(op)client.enqueue(op);
  }
  function handleAction(requestId:number,action:DashboardEventQueueAction,restoreFocus=false){
    if(dragActiveRef.current)return;
    enqueue(requestId,{kind:'action',action});if(restoreFocus)scheduleQueueRequestFocus(requestId);
  }
  function handleMove(requestId:number,direction:DashboardEventQueueMoveDirection){
    if(dragActiveRef.current)return;
    const index=approvedItems.findIndex(x=>x.id===requestId);if(index<0)return;
    enqueue(requestId,{kind:'placement',lane:'approved',position:index+1+(direction==='up'?-1:1)});
  }
  function handlePlacement(requestId:number,placement:QueueDropInput){
    if(!canMutate)return;
    const actor=client?.getActorId();if(!client||!actor)return;
    const snapshot=client.getSnapshot();
    const op=createQueueOperation(snapshot.items,deviceId,actor,snapshot.sortRevision,requestId,{kind:'placement',...placement});
    if(!op)return;
    if(placement.lane==='rejected'&&!placement.confirmed){
      rejectionFocusRequestRef.current=requestId;rejectionOperationRef.current=op;setPendingReject({requestId,placement});return;
    }
    client.enqueue(op);
  }
  function submitPlacement(requestId:number,placement:QueueDropInput){
    const op=rejectionOperationRef.current;
    if(op?.kind==='placement'&&op.requestId===requestId){client?.enqueue({...op,confirmed:true});rejectionOperationRef.current=null;}
    else handlePlacement(requestId,placement);
  }
  async function refreshQueue(){if(!state.ready)client?.reconnect();else await client?.refresh();}
  return (
    <section
      ref={queuePanelRef}
      aria-labelledby="event-queue-heading"
      className="@container/queue grid min-w-0 gap-5"
      data-event-queue-panel
    >
      <header className="flex min-w-0 flex-col gap-4 border-b border-border pb-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h2
            id="event-queue-heading"
            className="text-xl font-semibold tracking-[-0.02em]"
          >
            {tx("Kolejka operacyjna")}</h2>
          <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">
            {tx("Zgłoszenia tego wydarzenia. Zmiany są widoczne od razu, a niezależne operacje zapisują się równolegle w tle.")}</p>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge
            variant={liveStatus === "live" ? "default" : "secondary"}
            data-realtime-status={liveStatus}
          >
            {liveStatus === "live" ? (
              <CircleDot aria-hidden="true" data-icon="inline-start" />
            ) : liveStatus === "unavailable" ? (
              <WifiOff aria-hidden="true" data-icon="inline-start" />
            ) : (
              <RefreshCw
                aria-hidden="true"
                className="animate-spin"
                data-icon="inline-start"
              />
            )}
            {tx(formatLiveStatus(liveStatus))}
          </Badge>
          <Badge variant="secondary">
            {tx("Kolejka publiczna: ")}{publicQueueEnabled ? tx("włączona") : tx("wyłączona")}
          </Badge>
          <Badge variant="outline">
            {canMutate ? tx("Możesz zarządzać") : canManage ? tx("Zmiany niedostępne") : tx("Tylko podgląd")}
          </Badge>
          {isSyncing ? (
            <Badge variant="secondary" role="status">
              {tx("Synchronizacja…")}</Badge>
          ) : null}
          {state.entries.some(entry=>entry.phase==='sending') ? (
            <Badge variant="secondary" role="status">
              {tx("Trwa zapis…")}</Badge>
          ) : null}
          {errorSource === "refresh" ? (
            <Badge variant="destructive" role="status">
              {tx("Błąd synchronizacji")}</Badge>
          ) : null}
          {canManage ? <FairQueueControl
            organizationId={organizationId}
            eventId={eventId}
            disabled={lifecycle !== "active" || queueClosedDetected || pendingMutationCount > 0 || isRefreshing || dragActive || !!pendingReject || placementBusy}
            onBusyChange={setFairQueueBusy}
            onApplied={() => {void client?.refresh();}}
          /> : null}
          <Button
            variant="outline"
            type="button"
            onClick={() => void refreshQueue()}
            disabled={isRefreshing || fairQueueBusy || dragActive || placementBusy}
          >
            <RefreshCw
              aria-hidden="true"
              className={isRefreshing ? "animate-spin" : undefined}
              data-icon="inline-start"
            />
            {isRefreshing ? tx("Odświeżanie…") : tx("Odśwież")}
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2" data-queue-sync-state={!state.online?'offline':state.error?'local':state.entries.some(x=>x.phase==='conflict')?'conflict':state.entries.some(x=>x.phase==='sending')?'saving':pendingMutationCount?'local':state.ready?'synced':'loading'}>
        <Badge variant="secondary" role="status">{tx(!state.online?'Offline — zmiany zachowane lokalnie':state.error?'Brak aktualnego potwierdzenia synchronizacji':state.entries.some(x=>x.phase==='conflict')?'Konflikt — wymagana decyzja':state.entries.some(x=>x.phase==='sending')?'Zapisuję':pendingMutationCount?'Lokalnie — oczekiwanie na potwierdzenie':state.ready?'Zsynchronizowano':'Odtwarzanie synchronizacji…')}</Badge>
        {state.entries.some(x=>x.phase==='uncertain')?<Button variant="outline" onClick={()=>client?.retryUncertain()}>{tx("Ponów bezpiecznie")}</Button>:null}
      </div>
      {state.entries.filter(x=>x.phase==='conflict').map(entry=><Alert variant="destructive" key={entry.operation.operationId} data-queue-conflict>
        <AlertTitle>{tx("Zmiana zgłoszenia #{v0} nie została zapisana",{v0:entry.operation.requestId})}</AlertTitle>
        <AlertDescription>{tx(entry.error)} {tx("Sprawdź aktualną kolejkę. Odrzucenie dotyczy wyłącznie tej zachowanej lokalnej intencji.")}</AlertDescription>
        <Button variant="outline" onClick={()=>client?.discard(entry.operation.operationId)}>{tx("Odrzuć lokalną intencję")}</Button>
      </Alert>)}
      {!canManage || lifecycle !== "active" || queueClosedDetected ? (
        <Alert
          data-queue-closed={
            lifecycle !== "active" || queueClosedDetected ? true : undefined
          }
        >
          <LockKeyhole aria-hidden="true" />
          <AlertTitle>
            {lifecycle !== "active" || queueClosedDetected ? tx("Kolejka jest zamknięta") : tx("Tryb tylko do odczytu")}
          </AlertTitle>
          <AlertDescription>
            {!canManage ? (
              <>
                {tx("Rola viewer pozwala przeglądać kolejkę, ale nie zmieniać statusów zgłoszeń ani ich kolejności.")}{lifecycle !== "active" || queueClosedDetected ? ` ${tx(getClosedQueueDescription(lifecycle, queueClosedDetected))}` : null}
              </>
            ) : (
              getClosedQueueDescription(lifecycle, queueClosedDetected)
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>
            {tx("Nie udało się zsynchronizować kolejki")}
          </AlertTitle>
          <AlertDescription>{tx(error)}</AlertDescription>
        </Alert>
      ) : null}

      {items.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-border px-4 py-6 text-center"
          data-queue-empty
        >
          <p className="text-sm font-semibold">{tx("Brak zgłoszeń")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {tx("Nowe zgłoszenia z linku sesji pojawią się tutaj.")}</p>
        </div>
      ) : null}

      <section
        className="grid gap-3 border-b border-border pb-5"
        aria-labelledby="current-performance-heading"
      >
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 id="current-performance-heading" className="text-base font-semibold">
              {tx("Aktualnie śpiewane")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {tx("Jedno bieżące zgłoszenie w wydarzeniu.")}</p>
          </div>
          <Badge variant={currentItem ? "default" : "secondary"}>
            {currentItem ? tx("Występ trwa") : tx("Scena wolna")}
          </Badge>
        </div>
        {currentItem ? (
          <EventQueueRequestRow
            item={currentItem}
            participantPath={`/dashboard/org/${organizationId}/events/${eventId}/participants`}
            unconfirmed={state.unconfirmedIds.includes(currentItem.id)}
            canManage={canMutate}
            canMoveUp={false}
            canMoveDown={false}
            onAction={handleAction}
            onMove={handleMove}
          />
        ) : (
          <CardDescription className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
            {tx("Żadne zgłoszenie nie jest teraz oznaczone jako śpiewane.")}</CardDescription>
        )}
      </section>

      {dragNotice ? <QueueDragNotice>{tx(dragNotice)}</QueueDragNotice> : null}
      <QueueDragBoard
        generation={dragEpoch}
        id={`event-queue:${organizationId}:${eventId}`}
        items={items}
        canDrag={canMutate}
        onDraggingChange={(active, requestId) => {
          dragActiveRef.current = active; setDragActive(active);

          if (active) {setDragNotice(null);gestureRevision.current=queueGestureRevision(items);}
          if (!active && requestId !== undefined) scheduleQueueRequestFocus(requestId);
        }}
        onDrop={(requestId, placement) => {
          if (dragEpoch === dragEpochRef.current) handlePlacement(requestId, placement);
        }}
        renderRow={(item, dragHandle, overlay) => <EventQueueRequestRow
          item={item} participantPath={`/dashboard/org/${organizationId}/events/${eventId}/participants`} isDragOverlay={overlay} dragHandle={dragHandle} unconfirmed={state.unconfirmedIds.includes(item.id)}
          canManage={canMutate && !overlay}
          canMoveUp={approvedItems.findIndex(row => row.id === item.id) > 0}
          canMoveDown={item.status === "approved" && approvedItems.findIndex(row => row.id === item.id) < approvedItems.length - 1}
          onAction={handleAction} onMove={handleMove}
        />}
      />
      <AlertDialog open={pendingReject !== null} onOpenChange={open => { if (!open) setPendingReject(null); }}>
        <AlertDialogContent onCloseAutoFocus={event => {
          const requestId = rejectionFocusRequestRef.current;
          if (requestId !== null) {
            event.preventDefault();
            rejectionFocusRequestRef.current = null;
            scheduleQueueRequestFocus(requestId);
          }
        }}>
          <AlertDialogHeader><AlertDialogTitle>{tx("Odrzucić zgłoszenie?")}</AlertDialogTitle>
            <AlertDialogDescription>{tx("Zgłoszenie trafi do odrzuconych. Zmiana nastąpi dopiero po potwierdzeniu.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{tx("Anuluj")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => {
              if (pendingReject) submitPlacement(pendingReject.requestId, { ...pendingReject.placement, confirmed: true });
              setPendingReject(null);
            }}>{tx("Odrzuć zgłoszenie")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section
        className="grid gap-3 border-t border-border pt-5"
        aria-labelledby="queue-history-heading"
      >
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 id="queue-history-heading" className="text-base font-semibold">
              {tx("Historia")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {tx("Zagrane i pominięte zgłoszenia.")}</p>
          </div>
          <Badge variant="secondary">{closedItems.length}</Badge>
        </div>
        {closedItems.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {closedItems.map((item) => (
              <EventQueueRequestRow
                key={item.id}
                item={item}
                participantPath={`/dashboard/org/${organizationId}/events/${eventId}/participants`}
                unconfirmed={state.unconfirmedIds.includes(item.id)}
                canManage={canMutate}
                canMoveUp={false}
                canMoveDown={false}
                onAction={handleAction}
                onMove={handleMove}
              />
            ))}
          </div>
        ) : (
          <CardDescription className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
            {tx("Historia jest jeszcze pusta.")}</CardDescription>
        )}
      </section>
    </section>
  );
}

type EventQueueRequestRowProps = {
  item: DashboardEventQueueItemDto;
  canManage: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  dragHandle?: ReactNode;
  isDragOverlay?: boolean;
  unconfirmed?: boolean;
  participantPath?:string;
  onAction: (
    requestId: number,
    action: DashboardEventQueueAction,
    restoreFocus?: boolean,
  ) => void;
  onMove: (
    requestId: number,
    direction: DashboardEventQueueMoveDirection,
  ) => void;
};

function EventQueueRequestRow({
  item,
  canManage,
  canMoveUp,
  canMoveDown,
  dragHandle,
  isDragOverlay = false,
  unconfirmed = false,
  participantPath,
  onAction,
  onMove,
}: EventQueueRequestRowProps) {
  const tx = useUiText();
  const actionLabels = localizeUiRecord(getI18nRecord_actionLabels(), tx);

  const actions = getAvailableActions(item.status);
  const duration = formatDuration(item.song.durationSeconds);
  const requestLabel = getQueueRequestLabel(item);

  return (
    <article
      aria-label={tx("Zgłoszenie: {v0}", {v0: requestLabel})}
      aria-hidden={isDragOverlay ? true : undefined}
      data-queue-request-id={isDragOverlay ? undefined : item.id}
      data-queue-unconfirmed={unconfirmed || undefined}
      tabIndex={isDragOverlay ? undefined : -1}
      className={[
        "relative grid min-w-0 grid-cols-1 gap-x-3 gap-y-2.5 rounded-xl border px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:grid-cols-[minmax(0,1fr)_auto]",
        item.status === "now"
          ? "border-primary/45 bg-accent/35"
          : "border-border bg-card",
      ].join(" ")}
    >
      {dragHandle ? (
        <div className={"absolute right-2 top-2 z-10"}>{dragHandle}</div>
      ) : null}
      <div className={"min-w-0"}>
        <div className="flex flex-wrap items-center gap-1.5 pr-10 [&_strong]:text-sm">
          <strong>{item.displayName || item.singerName}</strong>
          <RequestStatusBadge status={item.status} />
          {unconfirmed ? <Badge variant="secondary">{tx("Lokalnie — oczekiwanie na potwierdzenie")}</Badge> : null}
          <Badge variant="outline">
            {item.requestedBy === "public" ? tx("Link sesji") : tx("Operator")}
          </Badge>
        </div>
        {item.eventParticipantId&&item.completedCount!==null&&item.completedCount!==undefined?<p className="mt-1 text-xs text-muted-foreground">
          {item.completedCount===0?tx("Pierwszy występ — brak potwierdzonych zakończeń"):tx("Zakończone występy: {v0}",{v0:item.completedCount})}
          {participantPath?<Link className="ml-2 underline" href={`${participantPath}?participant=${item.eventParticipantId}`}>{tx("Historia uczestnika")}</Link>:null}
        </p>:null}
        {item.requestDisplayName&&item.requestDisplayName!==item.displayName?<p className="text-xs text-muted-foreground">{tx("Zgłoszono jako: {v0}",{v0:item.requestDisplayName})}</p>:null}
        {item.fairInsertion?<details className="text-xs text-muted-foreground"><summary>{tx("Priorytet przy zatwierdzeniu")}</summary><p>{tx(item.fairInsertion.reason==='protected'?'Ochrona przed zbyt długim oczekiwaniem':item.fairInsertion.reason==='first'?'Pierwszy występ uczestnika':item.fairInsertion.reason==='separation'?'Rozdzielenie kolejnych występów tej samej osoby':'Priorytet rotacyjny')}</p>{item.fairInsertion.constrained?<p>{tx("Zachowano ręczną kolejność pozostałych zgłoszeń")}</p>:null}</details>:null}
        {item.mergedProfile?<p className="text-xs text-muted-foreground">{tx("Połączona historia profili")}</p>:null}
        {item.nicknameChanges?.length?<details className="text-xs text-muted-foreground"><summary>{tx("Zmiana nicku")}</summary>{item.nicknameChanges.map((change,index)=><p key={index}>{change.before} → {change.after} · {tx.date(change.at)}</p>)}</details>:null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className={"m-0 text-sm font-semibold leading-snug"}>{item.song.title}</p>
        </div>
        <p className={"mt-0.5 text-sm leading-snug text-muted-foreground"}>{item.song.artist}</p>
        {item.note ? <p className={"mt-2 text-sm leading-relaxed text-muted-foreground"}>{tx("Notatka: ")}{item.note}</p> : null}
      </div>

      <div className="flex flex-row flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground sm:flex-col sm:items-end sm:gap-1 sm:whitespace-nowrap">
        <span>
          {tx("Pozycja: ")}{item.status === "approved" ? item.position : "—"}
        </span>
        <span>{tx("Zgłoszono: ")}{tx.date(item.createdAt)}</span>
        {getQueueActivityTimestamp(item, tx.date) ? (
          <span>{tx(getQueueActivityTimestamp(item, tx.date))}</span>
        ) : null}
        {duration ? <span>{tx("Czas: ")}{duration}</span> : null}
      </div>

      {canManage && (actions.length > 0 || item.status === "approved") ? (
        <div className="col-span-full flex flex-wrap gap-2 border-t border-border pt-2.5">
          {item.status === "approved" ? (
            <>
              <Button
                size="icon-sm"
                variant="outline"
                type="button"
                className="size-11 sm:size-7"
                title={tx("Przesuń w górę")}
                aria-label={tx("Przesuń zgłoszenie w górę: {v0}", {v0: requestLabel})}
                onClick={() => void onMove(item.id, "up")}
                disabled={!canMoveUp}
              >
                <ArrowUp aria-hidden="true" data-icon="inline-start" />
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                type="button"
                className="size-11 sm:size-7"
                title={tx("Przesuń w dół")}
                aria-label={tx("Przesuń zgłoszenie w dół: {v0}", {v0: requestLabel})}
                onClick={() => void onMove(item.id, "down")}
                disabled={!canMoveDown}
              >
                <ArrowDown aria-hidden="true" data-icon="inline-start" />
              </Button>
            </>
          ) : null}

          {actions.map((action) => {
            if (action === "reject" || (action === "restore" && item.status === "now")) {
              return (
                <AlertDialog key={action}>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="destructive"
                      type="button"
                      className={`${destructiveButtonClassName} min-h-11 sm:min-h-7`}
                      aria-label={`${tx(action==='restore'&&item.status==='now'?"Anuluj występ":actionLabels[action])}: ${getQueueRequestLabel(item)}`}
                    >
                      {getActionIcon(action)}
                      {action==='restore'&&item.status==='now'?tx("Anuluj występ"):actionLabels[action]}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent data-management-theme="true">
                    <AlertDialogHeader>
                      <AlertDialogTitle>{tx(item.status==='now'?"Anulować rozpoczęty występ?":"Odrzucić zgłoszenie?")}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {tx(item.status==='now'?"Występ wróci do oczekujących i nie zostanie zaliczony. Wcześniejsze wykonania pozostaną w historii.":"Zgłoszenie zniknie z aktywnej kolejki. Można je później przywrócić.")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{tx("Anuluj")}</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        className={`${destructiveButtonClassName} min-h-11 sm:min-h-7`}
                        aria-label={`${tx(action==='restore'&&item.status==='now'?"Anuluj występ":actionLabels[action])}: ${getQueueRequestLabel(item)}`}
                        onClick={(event) =>
                          void onAction(item.id, action, event.detail === 0)
                        }
                      >
                        {tx(item.status==='now'?"Anuluj występ":"Odrzuć zgłoszenie")}</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              );
            }

            return (
              <Button
                key={action}
                size="sm"
                variant={
                  action === "restore"
                    ? "outline"
                    : action === "start" && item.status === "pending"
                      ? "secondary"
                    : action === "done" && item.status !== "now"
                      ? "secondary"
                      : "default"
                }
                type="button"
                className="min-h-11 sm:min-h-7"
                aria-label={`${tx(action==='restore'&&item.status==='now'?"Anuluj występ":actionLabels[action])}: ${getQueueRequestLabel(item)}`}
                onClick={(event) =>
                  void onAction(item.id, action, event.detail === 0)
                }
              >
                {getActionIcon(action)}
                {action==='restore'&&item.status==='now'?tx("Anuluj występ"):actionLabels[action]}
              </Button>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

function getAvailableActions(status: DashboardEventQueueRequestStatus) {
  return (["approve", "start", "reject", "done", "restore"] as const).filter((action) =>
    canApplyDashboardEventQueueAction(action, status),
  );
}

function getQueueRequestLabel(item: DashboardEventQueueItemDto) {
  return `${item.displayName || item.singerName} — ${item.song.title}`;
}


function getActionIcon(action: DashboardEventQueueAction) {
  switch (action) {
    case "approve":
      return <Check aria-hidden="true" data-icon="inline-start" />;
    case "start":
      return <Mic2 aria-hidden="true" data-icon="inline-start" />;
    case "reject":
      return <X aria-hidden="true" data-icon="inline-start" />;
    case "done":
      return <CircleCheck aria-hidden="true" data-icon="inline-start" />;
    case "restore":
      return <RotateCcw aria-hidden="true" data-icon="inline-start" />;
  }
}

function formatDateTime(value: string) {
  return formatWarsawDateTime(value);
}

function getQueueActivityTimestamp(item: DashboardEventQueueItemDto, format = formatDateTime) {
  if (item.completedAt) {
    return `Zakończono: ${format(item.completedAt)}`;
  }

  if (item.startedAt) {
    return `Rozpoczęto: ${format(item.startedAt)}`;
  }

  return null;
}

function getClosedQueueDescription(
  lifecycle: DashboardEventLifecycleStatus,
  queueClosedDetected: boolean,
) {
  if (queueClosedDetected || lifecycle === "closed") {
    return "Wydarzenie zostało zamknięte. Możesz nadal przeglądać i odświeżać dane, ale operacje kolejki są niedostępne.";
  }

  if (lifecycle === "cancelled") {
    return "Wydarzenie zostało anulowane. Kolejka pozostaje dostępna wyłącznie do odczytu.";
  }

  return "Wydarzenie jeszcze się nie rozpoczęło. Zarządzanie kolejką będzie dostępne po jego rozpoczęciu.";
}

function formatLiveStatus(status: QueueRealtimeConnectionStatus) {
  switch (status) {
    case "live":
      return "Aktualizacje na żywo";
    case "unavailable":
      return "Aktualizacje niedostępne";
    default:
      return "Łączenie…";
  }
}

function getI18nRecord_actionLabels() { return actionLabels; }

function queueGestureRevision(items:DashboardEventQueueItemDto[]){return items.map(x=>`${x.id}:${x.status}:${x.position}:${x.intentVersion??0}`).join("|");}
