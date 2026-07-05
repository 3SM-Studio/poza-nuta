import type { PublicQueueResponse, PublicSong } from "./api";

export type SessionEvent = {
  id: number;
  name: string;
  venue: string | null;
  startsAt: string;
  status: "draft" | "active" | "closed";
  publicQueueEnabled: boolean;
  publicShowSongTitles: boolean;
  autoCloseAt: string | null;
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

export async function getSessionEvent(code: string) {
  const response = await requestJson<{ event: SessionEvent }>(
    `/api/session/${encodeURIComponent(code)}/event`,
  );

  return response.event;
}

export async function searchSessionSongs(code: string, query: string) {
  const response = await requestJson<{ items: PublicSong[] }>(
    `/api/session/${encodeURIComponent(code)}/songs/search?q=${encodeURIComponent(query)}`,
  );

  return response.items;
}

export function createSessionRequest(
  code: string,
  input: {
    songId: number;
    requesterName: string;
  },
) {
  return requestJson(`/api/session/${encodeURIComponent(code)}/requests`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getSessionQueue(code: string) {
  return requestJson<PublicQueueResponse>(
    `/api/session/${encodeURIComponent(code)}/queue`,
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
  if (!path.startsWith("/api/session/")) {
    throw new SessionClientError(
      0,
      "INVALID_API_PATH",
      "Session API requests must use same-origin /api/session paths.",
    );
  }

  return path;
}
