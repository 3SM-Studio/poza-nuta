"use client";

import { ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import type { PublicQueueItem, PublicQueueResponse } from "./api";
import { SessionQueueList } from "./session-queue-list";
import { SessionSongArtwork } from "./session-song-artwork";
import { SessionParticipantRequests } from "./session-participant-requests";
import type { ParticipantRequest } from "./session-api";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

type SessionQueuePanelProps = {
  message: string | null;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  open: boolean;
  queue: PublicQueueResponse | null;
  refreshing: boolean;
  showPublicQueue?: boolean;
  participantRequests?: ParticipantRequest[] | null;
  participantRequestsMessage?: string | null;
  participantDisplayName?: string;
  cancellingRequestId?: string | null;
  cancelDialogRequestId?: string | null;
  onParticipantRefresh?: () => void;
  onCancelParticipantRequest?: (requestId: string) => void;
  onCancelDialogRequestIdChange?: (requestId: string | null) => void;
  defaultTab?: "queue" | "mine";
};

/** One queue state, presented as a desktop panel and a mobile expanding bar. */
export function SessionQueuePanel({
  message,
  onOpenChange,
  onRefresh,
  open,
  queue,
  refreshing,
  showPublicQueue = true,
  participantRequests = null,
  participantRequestsMessage = null,
  participantDisplayName,
  cancellingRequestId = null,
  cancelDialogRequestId = null,
  onParticipantRefresh = () => undefined,
  onCancelParticipantRequest = () => undefined,
  onCancelDialogRequestIdChange = () => undefined,
  defaultTab = "queue",
}: SessionQueuePanelProps) {
  const [activeTab, setActiveTab] = useState<"queue" | "mine">(showPublicQueue ? defaultTab : "mine");
  const hasParticipant = Boolean(participantDisplayName);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1280px)");
    const closeMobileDrawer = () => {
      if (window.innerWidth >= 1280 && open) onOpenChange(false);
    };
    closeMobileDrawer();
    desktop.addEventListener("change", closeMobileDrawer);
    window.addEventListener("resize", closeMobileDrawer);
    return () => {
      desktop.removeEventListener("change", closeMobileDrawer);
      window.removeEventListener("resize", closeMobileDrawer);
    };
  }, [onOpenChange, open]);

  return (
    <>
      <aside
        aria-label={showPublicQueue ? "Kolejka sesji" : "Moje zgłoszenia"}
        className="hidden min-h-0 w-[clamp(22.5rem,30vw,27.5rem)] shrink-0 border-l border-border bg-secondary/35 xl:flex xl:flex-col"
      >
        <div
          className="session-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-7"
          tabIndex={0}
        >
          <QueuePanelContents
            activeTab={activeTab}
            cancellingRequestId={cancellingRequestId}
            cancelDialogRequestId={cancelDialogRequestId}
            hasParticipant={hasParticipant}
            idPrefix="desktop"
            message={message}
            onCancel={onCancelParticipantRequest}
            onCancelDialogRequestIdChange={onCancelDialogRequestIdChange}
            onParticipantRefresh={onParticipantRefresh}
            onRefresh={onRefresh}
            onTabChange={setActiveTab}
            ownSingerName={participantDisplayName}
            participantRequests={participantRequests}
            participantRequestsMessage={participantRequestsMessage}
            queue={queue}
            refreshing={refreshing}
            showPublicQueue={showPublicQueue}
          />
        </div>
      </aside>

      <Drawer onOpenChange={onOpenChange} open={open}>
        <DrawerTrigger asChild>
          <button
            aria-label={showPublicQueue ? "Otwórz kolejkę" : "Otwórz moje zgłoszenia"}
            className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-popover px-3 text-left text-foreground shadow-[var(--shadow-panel)] transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/35 xl:hidden motion-reduce:transform-none motion-reduce:transition-none"
            type="button"
          >
            {showPublicQueue ? <CollapsedQueueSummary queue={queue} /> : <CollapsedParticipantSummary requests={participantRequests} />}
            <ChevronUp aria-hidden="true" className="ml-auto size-5 shrink-0 text-muted-foreground" />
          </button>
        </DrawerTrigger>

        <DrawerContent
          className="h-[calc(100dvh-0.5rem)] max-h-none border-x-0 border-t border-border bg-popover text-foreground xl:hidden"
          overlayClassName="bg-black/25 xl:hidden"
        >
          <div className="flex min-h-0 flex-1 flex-col">
            <DrawerTitle className="sr-only">{showPublicQueue ? "Kolejka" : "Moje zgłoszenia"}</DrawerTitle>
            <DrawerDescription className="sr-only">
              {showPublicQueue ? "Kolejka wydarzenia i Twoje zgłoszenia." : "Twoje zgłoszenia do tej sesji."}
            </DrawerDescription>
            <div className="flex shrink-0 justify-end px-4 pb-1">
              <DrawerClose asChild>
                <Button
                  aria-label="Zwiń kolejkę"
                  className="size-11 rounded-full"
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <ChevronDown aria-hidden="true" />
                </Button>
              </DrawerClose>
            </div>
            <div className="session-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
              <QueuePanelContents
                activeTab={activeTab}
                cancellingRequestId={cancellingRequestId}
                cancelDialogRequestId={cancelDialogRequestId}
                hasParticipant={hasParticipant}
                idPrefix="mobile"
                message={message}
                onCancel={onCancelParticipantRequest}
                onCancelDialogRequestIdChange={onCancelDialogRequestIdChange}
                onParticipantRefresh={onParticipantRefresh}
                onRefresh={onRefresh}
                onTabChange={setActiveTab}
                ownSingerName={participantDisplayName}
                participantRequests={participantRequests}
                participantRequestsMessage={participantRequestsMessage}
                queue={queue}
                refreshing={refreshing}
                showPublicQueue={showPublicQueue}
              />
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

function QueuePanelContents({
  activeTab,
  cancellingRequestId,
  cancelDialogRequestId,
  hasParticipant,
  idPrefix,
  message,
  onCancel,
  onCancelDialogRequestIdChange,
  onParticipantRefresh,
  onRefresh,
  onTabChange,
  ownSingerName,
  participantRequests,
  participantRequestsMessage,
  queue,
  refreshing,
  showPublicQueue,
}: {
  activeTab: "queue" | "mine";
  cancellingRequestId: string | null;
  cancelDialogRequestId: string | null;
  hasParticipant: boolean;
  idPrefix: string;
  message: string | null;
  onCancel: (requestId: string) => void;
  onCancelDialogRequestIdChange: (requestId: string | null) => void;
  onParticipantRefresh: () => void;
  onRefresh: () => void;
  onTabChange: (tab: "queue" | "mine") => void;
  ownSingerName?: string;
  participantRequests: ParticipantRequest[] | null;
  participantRequestsMessage: string | null;
  queue: PublicQueueResponse | null;
  refreshing: boolean;
  showPublicQueue: boolean;
}) {
  const panelId = `${idPrefix}-session-queue-panel`;
  const queueTabId = `${idPrefix}-session-queue-tab`;
  const mineTabId = `${idPrefix}-session-mine-tab`;
  const tabListRef = useRef<HTMLDivElement>(null);

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!hasParticipant || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextTab = event.key === "ArrowLeft" || event.key === "Home" ? "queue" : "mine";
    onTabChange(nextTab);
    window.requestAnimationFrame(() => {
      tabListRef.current?.querySelector<HTMLButtonElement>(`#${nextTab === "queue" ? queueTabId : mineTabId}`)?.focus();
    });
  }

  return (
    <div aria-labelledby={activeTab === "queue" ? queueTabId : mineTabId} id={panelId} role="tabpanel">
      {hasParticipant && showPublicQueue ? (
        <div aria-label="Widok kolejki" className="mb-5 grid grid-cols-2 rounded-xl bg-muted p-1" ref={tabListRef} role="tablist">
          <button aria-controls={panelId} aria-selected={activeTab === "queue"} className={`rounded-lg px-3 py-2 text-sm font-bold ${activeTab === "queue" ? "bg-popover text-foreground shadow-sm" : "text-muted-foreground"}`} id={queueTabId} onClick={() => onTabChange("queue")} onKeyDown={handleTabKeyDown} role="tab" tabIndex={activeTab === "queue" ? 0 : -1} type="button">Kolejka</button>
          <button aria-controls={panelId} aria-selected={activeTab === "mine"} className={`rounded-lg px-3 py-2 text-sm font-bold ${activeTab === "mine" ? "bg-popover text-foreground shadow-sm" : "text-muted-foreground"}`} id={mineTabId} onClick={() => onTabChange("mine")} onKeyDown={handleTabKeyDown} role="tab" tabIndex={activeTab === "mine" ? 0 : -1} type="button">Moje{participantRequests ? ` ${participantRequests.length}` : ""}</button>
        </div>
      ) : null}
      {activeTab === "queue" && showPublicQueue ? (
        <SessionQueueList className="max-w-none" message={message} onRefresh={onRefresh} ownSingerName={ownSingerName} queue={queue} refreshing={refreshing} />
      ) : (
        <SessionParticipantRequests cancellingRequestId={cancellingRequestId} cancelDialogRequestId={cancelDialogRequestId} message={participantRequestsMessage} onCancel={onCancel} onCancelDialogRequestIdChange={onCancelDialogRequestIdChange} onRefresh={onParticipantRefresh} requests={participantRequests} />
      )}
    </div>
  );
}

function CollapsedParticipantSummary({ requests }: { requests: ParticipantRequest[] | null }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-base font-extrabold tracking-[-0.02em]">Moje zgłoszenia</p>
      <p className="mt-0.5 truncate text-sm text-muted-foreground">
        {requests === null ? "Wczytywanie…" : requests.length === 0 ? "Brak aktywnych zgłoszeń" : `${requests.length} aktywne`}
      </p>
    </div>
  );
}

function CollapsedQueueSummary({ queue }: { queue: PublicQueueResponse | null }) {
  const currentItem = queue?.items.find((item) => item.status === "now");

  if (currentItem && queue) {
    return <CurrentSongSummary item={currentItem} showSongTitles={queue.showSongTitles} />;
  }

  const itemCount = queue?.items.length;
  const subtitle =
    itemCount === undefined
      ? "Wczytywanie kolejki…"
      : itemCount === 0
        ? "Brak utworów"
        : formatSongCount(itemCount);

  return (
    <div className="min-w-0">
      <p className="truncate text-base font-extrabold tracking-[-0.02em]">Kolejka</p>
      <p className="mt-0.5 truncate text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function CurrentSongSummary({
  item,
  showSongTitles,
}: {
  item: PublicQueueItem;
  showSongTitles: boolean;
}) {
  const hasSongDetails = showSongTitles && item.title;

  return (
    <>
      <SessionSongArtwork
        className="size-10 shrink-0 rounded-xl"
        song={{ id: item.id, title: item.title, artist: item.artist }}
      />
      <div className="min-w-0">
        <p className="truncate text-base font-extrabold tracking-[-0.02em]">
          {hasSongDetails ? item.title : item.singerName}
        </p>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">
          {hasSongDetails ? item.artist : "Tytuł ukryty publicznie"}
        </p>
      </div>
    </>
  );
}

function formatSongCount(count: number) {
  if (count === 1) return "1 utwór";
  if (
    count % 10 >= 2 &&
    count % 10 <= 4 &&
    (count % 100 < 12 || count % 100 > 14)
  ) {
    return `${count} utwory`;
  }
  return `${count} utworów`;
}
