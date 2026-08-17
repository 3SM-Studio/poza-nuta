import type {
  PublicQueueResponse,
  PublicSong,
  PublicSongBrowseItem,
  SessionSongBrowseInput,
  SessionSongDiscovery,
} from "./api";

export type SessionEvent = {
  name: string;
  venue: string | null;
  startsAt: string;
  status: "draft" | "active" | "closed" | "cancelled";
  publicQueueEnabled: boolean;
  songRequestsEnabled: boolean;
  publicShowSongTitles: boolean;
  autoCloseAt: string | null;
  endsAt: string;
  closedAt: string | null;
};

export type ParticipantRequestStatus =
  | "pending"
  | "approved"
  | "now"
  | "done"
  | "skipped"
  | "rejected";

export type ParticipantRequest = {
  id: string;
  title: string;
  artist: string;
  status: ParticipantRequestStatus;
  queuePosition: number | null;
  isNext: boolean;
  createdAt: string;
};

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
};

export class SessionClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "SessionClientError";
    this.status = status;
    this.code = code;
  }
}

export async function getSessionEvent(publicToken: string) {
  return requestJson<{
    accessStatus: "scheduled" | "active" | "closed";
    event: SessionEvent;
  }>(
    `/api/s/${encodeURIComponent(publicToken)}/event`,
  );
}

export async function searchSessionSongs(publicToken: string, query: string) {
  const response = await requestJson<{ items: PublicSong[] }>(
    `/api/s/${encodeURIComponent(publicToken)}/songs/search?q=${encodeURIComponent(query)}`,
  );

  return response.items;
}

export function getSessionSongDiscovery(
  publicToken: string,
  signal?: AbortSignal,
) {
  return requestJson<SessionSongDiscovery>(
    `/api/s/${encodeURIComponent(publicToken)}/songs/discovery`,
    { signal },
  );
}

export function browseSessionSongs(
  publicToken: string,
  input: SessionSongBrowseInput,
  signal?: AbortSignal,
) {
  const searchParams = new URLSearchParams();

  if (input.cursor) searchParams.set("cursor", input.cursor);
  if (input.limit) searchParams.set("limit", String(input.limit));
  if (input.q) searchParams.set("q", input.q);
  if (input.genre) searchParams.set("genre", input.genre);
  if (input.language) searchParams.set("language", input.language);
  if (input.duet) searchParams.set("duet", "true");
  if (input.hit) searchParams.set("hit", "true");
  if (input.sort) searchParams.set("sort", input.sort);

  const query = searchParams.toString();
  return requestJson<{
    items: PublicSongBrowseItem[];
    nextCursor: string | null;
  }>(
    `/api/s/${encodeURIComponent(publicToken)}/songs/browse${query ? `?${query}` : ""}`,
    { signal },
  );
}

export function createSessionRequest(
  publicToken: string,
  input: {
    songId: number;
  },
) {
  return requestJson(`/api/s/${encodeURIComponent(publicToken)}/requests`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function joinSession(publicToken: string, displayName: string) {
  return requestJson<{ participant: { displayName: string } }>(
    `/api/s/${encodeURIComponent(publicToken)}/join`,
    {
      method: "POST",
      body: JSON.stringify({ displayName }),
    },
  );
}

export function getSessionParticipant(publicToken: string) {
  return requestJson<{ participant: { displayName: string } | null }>(
    `/api/s/${encodeURIComponent(publicToken)}/participant`,
  );
}

export function renameSessionParticipant(publicToken: string, displayName: string) {
  return requestJson<{ participant: { displayName: string } }>(
    `/api/s/${encodeURIComponent(publicToken)}/participant`,
    { method: "PATCH", body: JSON.stringify({ displayName }) },
  );
}

export function getParticipantRequests(publicToken: string, signal?: AbortSignal) {
  return requestJson<{ items: ParticipantRequest[] }>(
    `/api/s/${encodeURIComponent(publicToken)}/requests/mine`,
    { signal },
  );
}

export function cancelParticipantRequest(publicToken: string, requestId: string) {
  return requestJson<{ request: { id: string; status: "skipped" } }>(
    `/api/s/${encodeURIComponent(publicToken)}/requests/${encodeURIComponent(requestId)}`,
    { method: "DELETE", body: "{}" },
  );
}

export function getSessionQueue(publicToken: string, signal?: AbortSignal) {
  return requestJson<PublicQueueResponse>(
    `/api/s/${encodeURIComponent(publicToken)}/queue`,
    { signal },
  );
}

async function requestJson<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(toSameOriginSessionApiPath(path), {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
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

    throw new SessionClientError(
      response.status,
      errorBody?.error?.code ?? "REQUEST_FAILED",
      errorBody?.error?.message ?? "Request failed.",
    );
  }

  return body as T;
}

function toSameOriginSessionApiPath(path: string) {
  if (!path.startsWith("/api/s/")) {
    throw new SessionClientError(
      0,
      "INVALID_API_PATH",
      "Session API requests must use same-origin canonical paths.",
    );
  }

  return path;
}
