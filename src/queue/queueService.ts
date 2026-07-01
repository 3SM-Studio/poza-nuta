import { randomUUID } from "node:crypto";
import type { OperatorQueue, PublicQueue, PublicQueueItem, QueueState, SongRequest } from "./types.ts";

type CreateEventInput = {
  id: string;
  name: string;
  venue?: string;
  date?: string;
  status?: QueueState["event"]["status"];
};

type AddRequestInput = {
  singerName: string;
  displayName?: string;
  songSource: SongRequest["songSource"];
  songSourceId?: string;
  songTitle: string;
  songArtist: string;
  songUrl?: string;
  note?: string;
};

type PublicQueueOptions = {
  hideSongTitles?: boolean;
};

export class QueueOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueOperationError";
  }
}

export function createEvent(input: CreateEventInput): QueueState {
  const now = timestamp();
  const venue = optionalText(input.venue);
  const date = optionalText(input.date);

  return {
    event: {
      id: requireText(input.id, "event id"),
      name: requireText(input.name, "event name"),
      status: input.status ?? "draft",
      createdAt: now,
      updatedAt: now,
      ...(venue ? { venue } : {}),
      ...(date ? { date } : {})
    },
    requests: []
  };
}

export function addRequest(state: QueueState, input: AddRequestInput): QueueState {
  const now = timestamp();
  const songSourceId = optionalText(input.songSourceId);
  const songUrl = optionalText(input.songUrl);
  const note = optionalText(input.note);
  const request: SongRequest = {
    id: randomUUID(),
    eventId: state.event.id,
    singerName: requireText(input.singerName, "singer name"),
    displayName: optionalText(input.displayName) ?? input.singerName,
    songSource: input.songSource,
    songTitle: requireText(input.songTitle, "song title"),
    songArtist: requireText(input.songArtist, "song artist"),
    status: "pending",
    position: null,
    createdAt: now,
    updatedAt: now,
    ...(songSourceId ? { songSourceId } : {}),
    ...(songUrl ? { songUrl } : {}),
    ...(note ? { note } : {})
  };

  return touchState({
    ...state,
    requests: [...state.requests, request]
  }, now);
}

export function approveRequest(state: QueueState, requestId: string): QueueState {
  const now = timestamp();
  const existing = getRequest(state, requestId);

  if (existing.status === "approved") {
    return renumberApproved(touchRequest(state, requestId, { updatedAt: now }), now);
  }

  if (existing.status !== "pending") {
    throw new QueueOperationError(`Only pending requests can be approved: ${requestId}`);
  }

  const nextPosition = getApprovedRequests(state).length + 1;
  return renumberApproved(touchRequest(state, requestId, { status: "approved", position: nextPosition, updatedAt: now }), now);
}

export function rejectRequest(state: QueueState, requestId: string): QueueState {
  const now = timestamp();
  const existing = getRequest(state, requestId);

  if (existing.status !== "pending" && existing.status !== "approved") {
    throw new QueueOperationError(`Only pending or approved requests can be rejected: ${requestId}`);
  }

  return renumberApproved(touchRequest(state, requestId, { status: "rejected", position: null, updatedAt: now }), now);
}

export function startRequest(state: QueueState, requestId: string): QueueState {
  const now = timestamp();
  const activeNow = state.requests.find((request) => request.status === "now");

  if (activeNow) {
    throw new QueueOperationError(`Request is already marked as now: ${activeNow.id}`);
  }

  const existing = getRequest(state, requestId);
  if (existing.status !== "approved") {
    throw new QueueOperationError(`Only approved requests can be started: ${requestId}`);
  }

  return renumberApproved(touchRequest(state, requestId, { status: "now", position: null, updatedAt: now }), now);
}

export function completeCurrentRequest(state: QueueState): QueueState {
  const now = timestamp();
  const activeNow = state.requests.find((request) => request.status === "now");

  if (!activeNow) {
    throw new QueueOperationError("No request is currently marked as now");
  }

  return touchState(touchRequest(state, activeNow.id, { status: "done", position: null, updatedAt: now }), now);
}

export function skipRequest(state: QueueState, requestId: string): QueueState {
  const now = timestamp();
  const existing = getRequest(state, requestId);

  if (existing.status === "done" || existing.status === "rejected" || existing.status === "skipped") {
    throw new QueueOperationError(`Request cannot be skipped from status ${existing.status}: ${requestId}`);
  }

  return renumberApproved(touchRequest(state, requestId, { status: "skipped", position: null, updatedAt: now }), now);
}

export function moveRequest(state: QueueState, requestId: string, newPosition: number): QueueState {
  const now = timestamp();
  const existing = getRequest(state, requestId);

  if (!Number.isFinite(newPosition)) {
    throw new QueueOperationError(`Invalid queue position: ${newPosition}`);
  }

  if (existing.status !== "approved") {
    throw new QueueOperationError(`Only approved requests can be moved: ${requestId}`);
  }

  const approved = getApprovedRequests(state).filter((request) => request.id !== requestId);
  const requestedPosition = Math.max(1, Math.min(Math.trunc(newPosition), approved.length + 1));
  approved.splice(requestedPosition - 1, 0, existing);

  const positions = new Map(approved.map((request, index) => [request.id, index + 1]));
  return touchState({
    ...state,
    requests: state.requests.map((request) =>
      positions.has(request.id)
        ? {
            ...request,
            position: positions.get(request.id) ?? null,
            updatedAt: request.id === requestId ? now : request.updatedAt
          }
        : request
    )
  }, now);
}

export function getPublicQueue(state: QueueState, options: PublicQueueOptions = {}): PublicQueue {
  const now = state.requests.find((request) => request.status === "now");
  const approved = getApprovedRequests(state);
  const next = approved[0] ? toPublicItem(approved[0], options) : undefined;
  const upcoming = approved.slice(1).map((request) => toPublicItem(request, options));

  return {
    now: now ? toPublicItem(now, options) : undefined,
    next,
    upcoming
  };
}

export function getOperatorQueue(state: QueueState): OperatorQueue {
  return {
    pending: byCreatedAt(state.requests.filter((request) => request.status === "pending")),
    now: byCreatedAt(state.requests.filter((request) => request.status === "now")),
    approved: getApprovedRequests(state),
    done: byUpdatedAtDesc(state.requests.filter((request) => request.status === "done")),
    skipped: byUpdatedAtDesc(state.requests.filter((request) => request.status === "skipped")),
    rejected: byUpdatedAtDesc(state.requests.filter((request) => request.status === "rejected"))
  };
}

function renumberApproved(state: QueueState, updatedAt: string): QueueState {
  const approvedIds = getApprovedRequests(state).map((request) => request.id);
  const positions = new Map(approvedIds.map((id, index) => [id, index + 1]));

  return touchState({
    ...state,
    requests: state.requests.map((request) => {
      if (request.status === "approved") {
        return {
          ...request,
          position: positions.get(request.id) ?? null
        };
      }

      if (request.position !== null && ["done", "skipped", "rejected"].includes(request.status)) {
        return {
          ...request,
          position: null
        };
      }

      return request;
    })
  }, updatedAt);
}

function touchRequest(state: QueueState, requestId: string, patch: Partial<SongRequest>): QueueState {
  let found = false;
  const requests = state.requests.map((request) => {
    if (request.id !== requestId) {
      return request;
    }

    found = true;
    return {
      ...request,
      ...patch
    };
  });

  if (!found) {
    throw new QueueOperationError(`Request not found: ${requestId}`);
  }

  return {
    ...state,
    requests
  };
}

function touchState(state: QueueState, updatedAt: string): QueueState {
  return {
    ...state,
    event: {
      ...state.event,
      updatedAt
    }
  };
}

function getRequest(state: QueueState, requestId: string): SongRequest {
  const request = state.requests.find((candidate) => candidate.id === requestId);
  if (!request) {
    throw new QueueOperationError(`Request not found: ${requestId}`);
  }

  return request;
}

function getApprovedRequests(state: QueueState): SongRequest[] {
  return state.requests
    .filter((request) => request.status === "approved")
    .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || a.createdAt.localeCompare(b.createdAt));
}

function toPublicItem(request: SongRequest, options: PublicQueueOptions): PublicQueueItem {
  const item: PublicQueueItem = {
    singerName: request.singerName,
    displayName: request.displayName,
    position: request.position
  };

  if (!options.hideSongTitles) {
    item.songTitle = request.songTitle;
    item.songArtist = request.songArtist;
  }

  return item;
}

function byCreatedAt(requests: SongRequest[]): SongRequest[] {
  return [...requests].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function byUpdatedAtDesc(requests: SongRequest[]): SongRequest[] {
  return [...requests].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function timestamp(): string {
  return new Date().toISOString();
}

function requireText(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new QueueOperationError(`Missing ${label}`);
  }

  return trimmed;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
