import {
  type DashboardEventQueueAction,
  type DashboardEventQueueMoveDirection,
  type DashboardEventQueueRequestStatus,
} from "@/lib/dashboard-event-queue";

import { OperatorClientError, type SongSource } from "./api";

export type DashboardEventQueueItemDto = {
  id: number;
  eventId: number;
  songId: number;
  singerName: string;
  displayName: string;
  note: string | null;
  status: DashboardEventQueueRequestStatus;
  position: number;
  requestedBy: "public" | "operator";
  version: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  song: {
    title: string;
    artist: string;
    source: SongSource;
    durationSeconds: number | null;
  };
};

export type DashboardEventQueueResponse = {
  organization: {
    publicId: string;
    name: string;
    role: "owner" | "manager" | "operator" | "viewer";
  };
  event: {
    id: number;
    name: string;
    venue: string | null;
    startsAt: string;
    status: "draft" | "active" | "closed";
    publicQueueEnabled: boolean;
    autoCloseAt: string | null;
    closedAt: string | null;
  };
  canManage: boolean;
  items: DashboardEventQueueItemDto[];
};

export type DashboardEventQueueActionResponse = {
  event: {
    id: number;
    name: string;
  };
  request: DashboardEventQueueItemDto;
};

export type DashboardEventQueueMoveResponse = {
  moved: boolean;
  event: {
    id: number;
    name: string;
  };
  request: DashboardEventQueueItemDto;
};

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
};

export function getDashboardEventQueue(
  organizationId: string,
  eventId: string,
  signal?: AbortSignal,
) {
  return requestJson<DashboardEventQueueResponse>(
    getDashboardEventQueueApiPath(organizationId, eventId),
    { signal },
  );
}

export function runDashboardEventQueueAction(
  organizationId: string,
  eventId: string,
  requestId: number,
  action: DashboardEventQueueAction,
) {
  return requestJson<DashboardEventQueueActionResponse>(
    getDashboardEventQueueActionApiPath(
      organizationId,
      eventId,
      requestId,
    ),
    {
      method: "POST",
      body: JSON.stringify({ action }),
    },
  );
}

export function moveDashboardEventQueueRequest(
  organizationId: string,
  eventId: string,
  requestId: number,
  direction: DashboardEventQueueMoveDirection,
) {
  return requestJson<DashboardEventQueueMoveResponse>(
    getDashboardEventQueueMoveApiPath(
      organizationId,
      eventId,
      requestId,
    ),
    {
      method: "POST",
      body: JSON.stringify({ direction }),
    },
  );
}

export function getDashboardEventQueueApiPath(
  organizationId: string,
  eventId: string,
) {
  return `/api/dashboard/organizations/${encodeURIComponent(
    organizationId,
  )}/events/${encodeURIComponent(eventId)}/queue`;
}

export function getDashboardEventQueueActionApiPath(
  organizationId: string,
  eventId: string,
  requestId: number,
) {
  return `${getDashboardEventQueueApiPath(
    organizationId,
    eventId,
  )}/requests/${encodeURIComponent(requestId)}/action`;
}

export function getDashboardEventQueueMoveApiPath(
  organizationId: string,
  eventId: string,
  requestId: number,
) {
  return `${getDashboardEventQueueApiPath(
    organizationId,
    eventId,
  )}/requests/${encodeURIComponent(requestId)}/move`;
}

async function requestJson<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as
    | ApiErrorBody
    | T
    | null;

  if (!response.ok) {
    const errorBody = body as ApiErrorBody | null;

    throw new OperatorClientError(
      response.status,
      errorBody?.error?.code ?? "REQUEST_FAILED",
      errorBody?.error?.message ?? "Nie udało się wykonać operacji.",
    );
  }

  return body as T;
}
