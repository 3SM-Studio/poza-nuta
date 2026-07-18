"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type DashboardEventSidebarContext = {
  eventId: string;
  name: string;
};

type EventSidebarContextValue = {
  event: DashboardEventSidebarContext | null;
  setEvent: (event: DashboardEventSidebarContext | null) => void;
};

const EventSidebarContext = createContext<EventSidebarContextValue | null>(null);

export function EventSidebarProvider({ children }: { children: ReactNode }) {
  const [event, setEvent] = useState<DashboardEventSidebarContext | null>(null);
  const value = useMemo(() => ({ event, setEvent }), [event]);

  return (
    <EventSidebarContext.Provider value={value}>
      {children}
    </EventSidebarContext.Provider>
  );
}

export function EventSidebarBridge({
  event,
  children,
}: {
  event: DashboardEventSidebarContext;
  children: ReactNode;
}) {
  const context = useContext(EventSidebarContext);
  const setEvent = context?.setEvent;

  useEffect(() => {
    setEvent?.(event);
    return () => setEvent?.(null);
  }, [event, setEvent]);

  return children;
}

export function useEventSidebarContext() {
  return useContext(EventSidebarContext)?.event ?? null;
}
