"use client";

import { useUiText } from "@/i18n/use-ui-text";
import { localizeUiRecord } from "@/i18n/text";

import { Fragment, memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, MouseSensor, TouchSensor,
  useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection, type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  canDropQueueRequest, containsQueuePoint, queueInsertionIndex, queuePlacementLabel, queuePlacementRevision,
  type QueueDropInput, type QueueLane, type QueuePlacement,
} from "@/lib/queue-placement";
import type { DashboardEventQueueItemDto } from "./event-queue-api";

const lanes: QueueLane[] = ["pending", "approved", "rejected"];
const labels = { pending: "Oczekujące", approved: "Zaakceptowane", rejected: "Odrzucone" };
type SlotData = QueuePlacement & { type: "slot"; allowed: boolean };
type LaneData = { type: "lane"; lane: QueueLane };
type RequestData = { type: "request"; requestId: number; lane: QueueLane };
type Props = {
  id: string;
  generation: number;
  items: DashboardEventQueueItemDto[];
  canDrag: boolean;
  onDraggingChange(active: boolean, requestId?: number): void;
  onDrop(requestId: number, placement: QueueDropInput): void;
  renderRow(item: DashboardEventQueueItemDto, handle?: ReactNode, overlay?: boolean): ReactNode;
};

export function QueueDragBoard({ id, generation, items, canDrag, onDraggingChange, onDrop, renderRow }: Props) {
  const tx = useUiText();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [activeGeneration, setActiveGeneration] = useState(generation);
  const [target, setTarget] = useState<SlotData | null>(null);
  const revisionRef = useRef("");
  const keyboardTargetRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const staleGesture = activeId !== null && activeGeneration !== generation;
  const activeItem = staleGesture ? undefined : items.find(row => row.id === activeId);
  const board = useMemo(() => Object.fromEntries(lanes.map(lane => [lane, items.filter(row => row.status === lane)])) as Record<QueueLane, DashboardEventQueueItemDto[]>, [items]);

  const collisionDetection: CollisionDetection = args => {
    const source = args.active.data.current as RequestData | undefined;
    if (!source) return [];
    if (!args.pointerCoordinates && keyboardTargetRef.current) {
      const slot = args.droppableContainers.find(container => container.id === keyboardTargetRef.current);
      return slot ? [{ id: slot.id, data: { droppableContainer: slot, value: 1 } }] : [];
    }
    const point = args.pointerCoordinates ?? {
      x: args.collisionRect.left + args.collisionRect.width / 2,
      y: args.collisionRect.top + args.collisionRect.height / 2,
    };
    if (point.x < 0 || point.y < 0 || point.x > window.innerWidth || point.y > window.innerHeight) return [];
    const container = args.droppableContainers.find(container => {
      const data = container.data.current as LaneData | SlotData | undefined;
      const rect = args.droppableRects.get(container.id);
      return data?.type === "lane" && rect && containsQueuePoint(rect, point);
    });
    if (!container) return [];
    const lane = (container.data.current as LaneData).lane;
    const rows = board[lane].flatMap(row => {
      const rect = args.droppableRects.get(`row:${row.id}`);
      return rect ? [{ id: row.id, rect }] : [];
    });
    const position = lane === "approved" ? queueInsertionIndex(point.y, rows, source.requestId) + 1 : 1;
    const slot = args.droppableContainers.find(container => {
      const data = container.data.current as SlotData | undefined;
      return data?.type === "slot" && data.lane === lane && data.position === position;
    });
    return slot ? [{ id: slot.id, data: { droppableContainer: slot, value: 1 } }] : [];
  };

  const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
    if (staleGesture) return;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.code)) return;
    event.preventDefault();
    const { active, over, droppableContainers, droppableRects, collisionRect } = args.context;
    if (!active || !collisionRect) return;
    const source = active.data.current as RequestData;
    const current = over?.data.current as SlotData | undefined;
    let lane = current?.lane ?? source.lane;
    const count = (value: QueueLane) => value === "approved" ? board.approved.filter(row => row.id !== source.requestId).length + 1 : 1;
    let position = current?.position ?? (lane === "approved" ? Math.max(1, board.approved.findIndex(row => row.id === source.requestId) + 1) : 1);
    if (event.code === "Home") position = 1;
    else if (event.code === "End") position = count(lane);
    else if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
      lane = lanes[Math.max(0, Math.min(2, lanes.indexOf(lane) + (event.code === "ArrowLeft" ? -1 : 1)))];
      position = 1;
    } else {
      const delta = event.code === "ArrowUp" ? -1 : 1;
      if (position + delta >= 1 && position + delta <= count(lane)) position += delta;
      else {
        lane = lanes[Math.max(0, Math.min(2, lanes.indexOf(lane) + delta))];
        position = delta < 0 ? count(lane) : 1;
      }
    }
    const slot = droppableContainers.getEnabled().find(container => {
      const data = container.data.current as SlotData | undefined;
      return data?.type === "slot" && data.lane === lane && data.position === position;
    });
    const rect = slot && droppableRects.get(slot.id);
    if (!rect) return;
    keyboardTargetRef.current = String(slot.id);
    // Home/End can jump beyond the viewport. Scroll the actual slot, then use
    // its live rect; the logical slot remains authoritative while scrolling.
    slot.node.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    const liveRect = slot.node.current?.getBoundingClientRect() ?? rect;
    return { x: liveRect.left + liveRect.width / 2 - collisionRect.width / 2, y: liveRect.top + liveRect.height / 2 - collisionRect.height / 2 };
  };
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates, scrollBehavior: "auto" }),
  );
  const finish = () => {
    if (!mountedRef.current) return;
    setActiveId(null); setTarget(null); onDraggingChange(false, activeId ?? undefined);
  };
  const announce = (data: SlotData | null) => tx(queuePlacementLabel(data, data?.allowed));

  // Keep sensor ownership until its physical up/cancel event. Remounting an
  // active DndContext can leave an obsolete sensor waiting on the document.
  // Generation invalidates visuals and writes immediately, without replacing it.
  return <DndContext id={id} sensors={sensors} collisionDetection={collisionDetection} autoScroll={!staleGesture}
    measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
    onDragStart={event => {
      const data = event.active.data.current as RequestData;
      if (!canDrag || !mountedRef.current) return;
      revisionRef.current = queuePlacementRevision(items);
      keyboardTargetRef.current = null;
      setActiveGeneration(generation);
      setActiveId(data.requestId); setTarget(null); onDraggingChange(true, data.requestId);
    }}
    onDragOver={event => { if (mountedRef.current) setTarget(event.over ? event.over.data.current as SlotData : null); }}
    onDragCancel={finish}
    onDragEnd={event => {
      if (!mountedRef.current) return;
      const source = event.active.data.current as RequestData;
      const destination = event.over?.data.current as SlotData | undefined;
      finish();
      if (!staleGesture && canDrag && destination?.type === "slot" && destination.allowed && queuePlacementRevision(items) === revisionRef.current) {
        const current = board.approved.findIndex(row => row.id === source.requestId) + 1;
        if (source.lane === "approved" && destination.lane === "approved" && current === destination.position) return;
        onDrop(source.requestId, { lane: destination.lane, position: destination.position, expectedRevision: revisionRef.current });
      }
    }}
    accessibility={{
      screenReaderInstructions: { draggable: tx("Spacja podnosi i upuszcza. Strzałki wybierają pozycję lub sekcję. Home i End: początek i koniec. Escape anuluje.") },
      announcements: {
        onDragStart: () => tx("Podniesiono zgłoszenie. Strzałkami wybierz pozycję. Escape anuluje."),
        onDragOver: ({ over }) => announce(over ? over.data.current as SlotData : null),
        onDragEnd: ({ over }) => staleGesture ? tx("Kolejka uległa zmianie. Anulowano przeniesienie.") : over ? tx("Wybrano: {v0}. Oczekiwanie na zapis lub potwierdzenie.", { v0: announce(over.data.current as SlotData) }) : tx("Anulowano przeniesienie."),
        onDragCancel: () => tx("Anulowano przeniesienie. Kolejka bez zmian."),
      },
    }}>
    <div data-queue-board className="grid grid-cols-1 items-start gap-4 @min-[48rem]/queue:grid-cols-2">
      {lanes.map(lane => <Lane key={lane} lane={lane} items={board[lane]} active={activeItem} target={target} canDrag={canDrag} renderRow={renderRow} />)}
    </div>
    {activeItem ? <QueueDragNotice dropFeedback>{announce(target)}</QueueDragNotice> : null}
    <DragOverlay dropAnimation={{ duration: windowReducedMotion() ? 0 : 140, easing: "ease-out" }}>
      {activeItem ? <div data-queue-drag-overlay className="pointer-events-none h-full w-full opacity-95 shadow-xl [&>article]:h-full">{renderRow(activeItem, undefined, true)}</div> : null}
    </DragOverlay>
  </DndContext>;
}

/** Status changes must never add/remove space above or below a live drag. */
export function QueueDragNotice({ children, dropFeedback = false }: { children: ReactNode; dropFeedback?: boolean }) {
  if (typeof document === "undefined") return null;
  return createPortal(<p role="status" aria-live="polite" data-queue-drop-feedback={dropFeedback ? true : undefined}
    className="pointer-events-none fixed bottom-3 left-1/2 z-30 w-max max-w-[92vw] -translate-x-1/2 rounded-lg border bg-background px-4 py-2 text-sm font-medium shadow-md">
    {children}
  </p>, document.body);
}

function windowReducedMotion() { return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches; }

function Lane({ lane, items, active, target, canDrag, renderRow }: {
  lane: QueueLane; items: DashboardEventQueueItemDto[]; active?: DashboardEventQueueItemDto; target: SlotData | null;
  canDrag: boolean; renderRow: Props["renderRow"];
}) {
  const tx = useUiText();
  const labels = localizeUiRecord(getI18nRecord_labels(), tx);

  const { setNodeRef } = useDroppable({ id: `lane:${lane}`, data: { type: "lane", lane } satisfies LaneData, disabled: !canDrag });
  const remaining = items.filter(row => row.id !== active?.id);
  const positions = new Map(remaining.map((row, index) => [row.id, index + 1]));
  const allowed = !!active && canDropQueueRequest(active.status, lane);
  return <section data-queue-lane={lane} aria-labelledby={`queue-lane-${lane}`} className={[
    "grid min-h-48 content-start rounded-xl border bg-muted/25 p-3 transition-colors motion-reduce:transition-none",
    lane === "rejected" ? "col-span-full" : "",
    target?.lane === lane ? allowed ? "border-primary bg-primary/5" : "border-destructive" : "border-border",
  ].join(" ")}>
    <header className="flex items-center justify-between gap-3 px-1 pb-3">
      <div><h3 id={`queue-lane-${lane}`} className="font-semibold">{labels[lane]}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{lane === "approved" ? tx("Kolejność występów") : lane === "pending" ? tx("Według czasu zgłoszenia") : tx("Według czasu odrzucenia")}</p></div>
      <Badge variant={lane === "approved" ? "default" : "secondary"}>{items.length}</Badge>
    </header>
    <div ref={setNodeRef} data-queue-drop-body={lane} className="grid min-h-28 content-start">
      {lane !== "approved" ? <Slot lane={lane} position={1} allowed={allowed} enabled={canDrag} active={!!active} /> : null}
      {items.map(row => <Fragment key={row.id}>
        {lane === "approved" ? row.id === active?.id ? <div className="h-3" aria-hidden="true" /> : <Slot lane={lane} position={positions.get(row.id)!} allowed={allowed} enabled={canDrag} active={!!active} /> : null}
        <DraggableRow item={row} lane={lane} canDrag={canDrag} renderRow={renderRow}
          dragVisible={!!active}
          makeRoom={!!active && allowed && target?.lane === lane && lane === "approved" && target.position === positions.get(row.id)} />
      </Fragment>)}
      {lane === "approved" ? <Slot lane={lane} position={remaining.length + 1} allowed={allowed} enabled={canDrag} active={!!active} /> : null}
      {items.length === 0 ? <div className="pointer-events-none grid min-h-24 place-items-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground">{tx("Upuść zgłoszenie tutaj")}</div> : null}
    </div>
  </section>;
}

function Slot({ lane, position, allowed, enabled, active }: QueuePlacement & { allowed: boolean; enabled: boolean; active: boolean }) {
  const tx = useUiText();

  const { setNodeRef, isOver } = useDroppable({ id: `slot:${lane}:${position}`, disabled: !enabled,
    data: { type: "slot", lane, position, allowed } satisfies SlotData });
  return <div ref={setNodeRef} className="relative h-3" data-queue-slot={`${lane}:${position}`}>
    {isOver && active ? <div data-queue-insertion-indicator data-target-lane={lane} data-target-position={position} data-drop-allowed={allowed}
      className={`pointer-events-none absolute inset-x-0 top-1 z-20 border-t-2 ${allowed ? "border-primary" : "border-destructive"}`}>
      <span className={`absolute right-1 -top-3 rounded px-2 py-0.5 text-xs font-semibold text-background ${allowed ? "bg-primary" : "bg-destructive"}`}>
        {tx(queuePlacementLabel({ lane, position }, allowed))}
      </span>
    </div> : null}
  </div>;
}

const DraggableRow = memo(function DraggableRow({ item, lane, canDrag, renderRow, makeRoom, dragVisible }: { item: DashboardEventQueueItemDto; lane: QueueLane; canDrag: boolean; renderRow: Props["renderRow"]; makeRoom: boolean; dragVisible: boolean }) {
  const tx = useUiText();

  const { setNodeRef, setActivatorNodeRef, isDragging, attributes, listeners } = useDraggable({ id: `request:${item.id}`, data: { type: "request", requestId: item.id, lane } satisfies RequestData, disabled: !canDrag });
  const { setNodeRef: setDropRef } = useDroppable({ id: `row:${item.id}`, data: { type: "row", lane }, disabled: !canDrag });
  return <div ref={node => { setNodeRef(node); setDropRef(node); }} style={{ opacity: isDragging && dragVisible ? 0.3 : 1, transform: makeRoom && !windowReducedMotion() ? "translateY(3px)" : undefined }} className="min-w-0 transition-[transform,opacity] duration-150 ease-out motion-reduce:transform-none! motion-reduce:transition-none">
    {renderRow(item, canDrag ? <Button ref={setActivatorNodeRef} size="icon-lg" variant="ghost" type="button"
      className="size-11 touch-none select-none cursor-grab focus-visible:ring-2 active:cursor-grabbing sm:size-9"
      aria-label={tx("Przeciągnij zgłoszenie: {v0} — {v1}", {v0: item.displayName || item.singerName, v1: item.song.title})} title={tx("Przeciągnij zgłoszenie")}
      {...attributes} {...listeners}><GripVertical aria-hidden="true" /></Button> : undefined)}
  </div>;
});

function getI18nRecord_labels() { return labels; }
