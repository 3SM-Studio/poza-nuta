import type { PublicQueueResponse, PublicSong } from "./api";

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

export function createSessionRequest(
  publicToken: string,
  input: {
    songId: number;
    requesterName: string;
  },
) {
  return requestJson(`/api/s/${encodeURIComponent(publicToken)}/requests`, {
    method: "POST",
    body: JSON.stringify(input),
  });
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
