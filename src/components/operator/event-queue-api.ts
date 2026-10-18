import {
  type DashboardEventQueueAction,
  type DashboardEventQueueMoveDirection,
  type DashboardEventQueueMoveInput,
  type DashboardEventQueueRequestStatus,
} from "@/lib/dashboard-event-queue";

import { OperatorClientError, type SongSource } from "./api";
import type { QueueDropInput } from "@/lib/queue-placement";
import type { QueueOperation } from "@/lib/queue-operation";

export type DashboardEventQueueItemDto = {
  id: number;
  eventId: number;
  songId: number;
  singerName: string;
  displayName: string;
  fairInsertion?:{reason:string;constrained:boolean};
  currentDisplayName?:string; requestDisplayName?:string; eventParticipantId?:number|null;
  completedCount?:number|null; performing?:boolean; joinedAt?:string|null;
  nicknameChanges?:{before:string;after:string;at:string}[]; mergedProfile?:boolean;
  note: string | null;
  status: DashboardEventQueueRequestStatus;
  position: number;
  requestedBy: "public" | "operator";
  version: number;
  intentVersion?: number;
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
  items: DashboardEventQueueItemDto[];
  event: {
    id: number;
    name: string;
  };
  request: DashboardEventQueueItemDto;
};

export type DashboardEventQueueMoveResponse = {
  items: DashboardEventQueueItemDto[];
  moved: boolean;
  event: {
    id: number;
    name: string;
  };
  request: DashboardEventQueueItemDto;
};

export function placeDashboardEventQueueRequest(organizationId: string, eventId: string, requestId: number, placement: QueueDropInput) {
  return requestJson<DashboardEventQueueActionResponse>(`${getDashboardEventQueueApiPath(organizationId, eventId)}/requests/${requestId}/placement`, {
    method: "POST", body: JSON.stringify(placement),
  });
}

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
};

export type FairQueuePreview = {
  revision: string;
  engine?:string;
  changes: { id: number; from: number; to: number; displayName: string; songTitle: string; decision?:import('@/server/fair-queue-v2').FairDecision }[];
};

export function previewDashboardFairQueue(organizationId: string, eventId: string, signal?: AbortSignal) {
  return requestJson<FairQueuePreview>(`${getDashboardEventQueueApiPath(organizationId, eventId)}/fair`, {
    method: "POST", body: JSON.stringify({ action: "preview" }), signal,
  });
}

export function applyDashboardFairQueue(organizationId: string, eventId: string, revision: string, signal?: AbortSignal) {
  return requestJson<{ changed: number; items: DashboardEventQueueItemDto[] }>(`${getDashboardEventQueueApiPath(organizationId, eventId)}/fair`, {
    method: "POST", body: JSON.stringify({ action: "apply", revision }), signal,
  });
}

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
  move: DashboardEventQueueMoveDirection | DashboardEventQueueMoveInput,
) {
  const moveInput =
    typeof move === "string" ? { direction: move } : move;

  return requestJson<DashboardEventQueueMoveResponse>(
    getDashboardEventQueueMoveApiPath(
      organizationId,
      eventId,
      requestId,
    ),
    {
      method: "POST",
      body: JSON.stringify(moveInput),
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

export type QueueSyncSnapshot = {
  actorId: number; eventId: number; revision: string; sortRevision: string;
  items: DashboardEventQueueItemDto[]; acknowledged: string[];
  canManage?: boolean; lifecycle?: string;
  trace?: {requestId:string;operationId:string;revision:string}|null;
};
export function getQueueSync(organizationId: string,eventId: string,deviceId: string,operationIds: string[],signal?: AbortSignal) {
  const query=new URLSearchParams({deviceId});
  for (const id of operationIds) query.append('operationId',id);
  return requestJson<QueueSyncSnapshot>(`${getDashboardEventQueueApiPath(organizationId,eventId)}/sync?${query}`,{signal});
}
export function sendQueueOperation(organizationId: string,eventId: string,operation: QueueOperation,signal?: AbortSignal) {
  return requestJson<QueueSyncSnapshot & { operationId:string }>(`${getDashboardEventQueueApiPath(organizationId,eventId)}/sync`,{
    method:'POST',body:JSON.stringify(operation),signal,
  });
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
      errorBody?.error?.message ?? "Nie udaĹ‚o siÄ™ wykonaÄ‡ operacji.",
    );
  }

  return body as T;
}
