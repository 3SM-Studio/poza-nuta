export type OperatorRequestStatus =
  | "pending"
  | "approved"
  | "now"
  | "done"
  | "skipped"
  | "rejected";

export type OperatorQueueAction =
  | "approve"
  | "reject"
  | "start"
  | "done"
  | "skip";

export type OperatorIdentity = {
  id: number;
  name: string;
  active: true;
};

export type OperatorQueueItem = {
  id: number;
  eventId: number;
  songId: number;
  singerName: string;
  displayName: string;
  note: string | null;
  status: OperatorRequestStatus;
  position: number;
  requestedBy: "public" | "operator";
  createdByOperatorId: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  song: {
    title: string;
    artist: string;
    durationSeconds: number | null;
    source?: string;
  };
};

export type OperatorQueueResponse = {
  event: {
    id: number;
    name: string;
    venue: string | null;
    startsAt: string;
    status: "active";
  };
  queue: Record<OperatorRequestStatus, OperatorQueueItem[]>;
};

type OperatorMeResponse = {
  operator: OperatorIdentity;
  expiresAt: string;
};

type OperatorLoginInput = {
  name: string;
  pin: string;
};

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
};

export class OperatorClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "OperatorClientError";
    this.status = status;
    this.code = code;
  }
}

export function loginOperator(input: OperatorLoginInput) {
  return requestJson<OperatorMeResponse>("/api/operator/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function logoutOperator() {
  return requestJson<{ success: true }>("/api/operator/logout", {
    method: "POST",
  });
}

export function getCurrentOperator() {
  return requestJson<OperatorMeResponse>("/api/operator/me");
}

export function getOperatorQueue() {
  return requestJson<OperatorQueueResponse>("/api/operator/queue");
}

export function runOperatorQueueAction(
  requestId: number,
  action: OperatorQueueAction,
) {
  return requestJson(
    `/api/operator/requests/${encodeURIComponent(requestId)}/${action}`,
    { method: "POST" },
  );
}

export function formatDuration(durationSeconds: number | null) {
  if (durationSeconds === null || durationSeconds < 0) {
    return null;
  }

  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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
