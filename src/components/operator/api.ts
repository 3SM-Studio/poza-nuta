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

export type DashboardEvent = {
  id: number;
  name: string;
  venue: string | null;
  startsAt: string;
  status: "active" | "closed";
  isActivePublicEvent: boolean;
  publicQueueEnabled: boolean;
  publicShowSongTitles: boolean;
  autoCloseAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
    autoCloseAt: string | null;
    closedAt: string | null;
  };
  queue: Record<OperatorRequestStatus, OperatorQueueItem[]>;
};

type OperatorMeResponse = {
  operator: OperatorIdentity;
  authUser?: {
    id: string;
    email: string | null;
  };
};

type OperatorLoginInput = {
  email: string;
  password: string;
};

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
};

export const dashboardApiPaths = {
  login: "/api/dashboard/login",
  logout: "/api/dashboard/logout",
  me: "/api/dashboard/me",
  queue: "/api/dashboard/queue",
  event: "/api/dashboard/event",
  extendEvent: "/api/dashboard/event/extend",
  closeEvent: "/api/dashboard/event/close",
  startEvent: "/api/dashboard/event/start",
} as const;

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
  return requestJson<OperatorMeResponse>(dashboardApiPaths.login, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function logoutOperator() {
  return requestJson<{ success: true }>(dashboardApiPaths.logout, {
    method: "POST",
  });
}

export function getCurrentOperator() {
  return requestJson<OperatorMeResponse>(dashboardApiPaths.me);
}

export function getOperatorQueue() {
  return requestJson<OperatorQueueResponse>(dashboardApiPaths.queue);
}

export function getDashboardEvent() {
  return requestJson<{ event: DashboardEvent | null }>(
    dashboardApiPaths.event,
  );
}

export function updateDashboardEventSettings(input: {
  name: string;
  venue: string | null;
  publicQueueEnabled: boolean;
  publicShowSongTitles: boolean;
}) {
  return requestJson<{ event: DashboardEvent }>(dashboardApiPaths.event, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function extendDashboardEvent(hours: 1 | 2) {
  return requestJson<{ event: DashboardEvent }>(
    dashboardApiPaths.extendEvent,
    {
      method: "POST",
      body: JSON.stringify({ hours }),
    },
  );
}

export function closeDashboardEvent() {
  return requestJson<{ event: DashboardEvent }>(
    dashboardApiPaths.closeEvent,
    { method: "POST" },
  );
}

export function startDashboardEvent(input: {
  name: string;
  venue: string | null;
}) {
  return requestJson<{ event: DashboardEvent }>(
    dashboardApiPaths.startEvent,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function runOperatorQueueAction(
  requestId: number,
  action: OperatorQueueAction,
) {
  return requestJson(getDashboardRequestActionPath(requestId, action), {
    method: "POST",
  });
}

export function getDashboardRequestActionPath(
  requestId: number,
  action: OperatorQueueAction,
) {
  return `/api/dashboard/requests/${encodeURIComponent(requestId)}/${action}`;
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
