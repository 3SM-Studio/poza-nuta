export type PublicEvent = {
  id: number;
  name: string;
  venue: string | null;
  startsAt: string;
  status: "active";
  publicQueueEnabled: boolean;
  publicShowSongTitles: boolean;
};

export type PublicSong = {
  id: number;
  source: "ising" | "karafun" | "manual";
  title: string;
  artist: string;
  durationSeconds: number | null;
  isDuet: boolean;
  isExplicit: boolean;
  isPlus: boolean;
  isHit: boolean;
};

export type PublicQueueItem = {
  id: number;
  singerName: string;
  status: "approved" | "now";
  position: number;
  createdAt: string;
  title?: string;
  artist?: string;
};

export type PublicQueueResponse = {
  eventId: number;
  enabled: boolean;
  showSongTitles: boolean;
  items: PublicQueueItem[];
};

type DashboardMeResponse = {
  operator: {
    id: number;
    name: string;
    active: true;
  };
};

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
};

export class PublicClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PublicClientError";
    this.status = status;
    this.code = code;
  }
}

export async function getPublicEvent() {
  const response = await requestJson<{ event: PublicEvent }>(
    "/api/public/event",
  );

  return response.event;
}

export async function searchPublicSongs(query: string) {
  const response = await requestJson<{ items: PublicSong[] }>(
    `/api/public/songs/search?q=${encodeURIComponent(query)}`,
  );

  return response.items;
}

export function createPublicRequest(input: {
  songId: number;
  singerName: string;
  note: string | null;
}) {
  return requestJson("/api/public/requests", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getPublicQueue() {
  return requestJson<PublicQueueResponse>("/api/public/queue");
}

export async function getDashboardEntryStatus() {
  try {
    await requestJson<DashboardMeResponse>("/api/dashboard/me");

    return { canEnterDashboard: true };
  } catch {
    return { canEnterDashboard: false };
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(toSameOriginApiPath(path), {
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

    throw new PublicClientError(
      response.status,
      errorBody?.error?.code ?? "REQUEST_FAILED",
      errorBody?.error?.message ?? "Request failed.",
    );
  }

  return body as T;
}

function toSameOriginApiPath(path: string) {
  if (!path.startsWith("/api/")) {
    throw new PublicClientError(
      0,
      "INVALID_API_PATH",
      "Public API requests must use same-origin /api paths.",
    );
  }

  return path;
}
