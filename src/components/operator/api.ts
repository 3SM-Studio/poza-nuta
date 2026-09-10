export type SongSource = "ising" | "karafun" | "manual";

export type OperatorIdentity = {
  id: number;
  name: string;
  displayName: string | null;
  profileCompletedAt: string | null;
  active: true;
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

type OperatorSignupInput = {
  email: string;
  password: string;
  confirmPassword: string;
};

type OperatorSignupResponse = {
  status: "signed_in" | "check_email";
  operator: OperatorIdentity;
};

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
};

export const dashboardApiPaths = {
  login: "/api/dashboard/login",
  signup: "/api/dashboard/signup",
  logout: "/api/dashboard/logout",
  me: "/api/dashboard/me",
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

export function signupOperator(input: OperatorSignupInput) {
  return requestJson<OperatorSignupResponse>(dashboardApiPaths.signup, {
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

export function formatDuration(durationSeconds: number | null) {
  if (durationSeconds === null || durationSeconds < 0) {
    return null;
  }

  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function requestJson<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(toSameOriginApiPath(path), {
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

function toSameOriginApiPath(path: string) {
  if (!path.startsWith("/api/")) {
    throw new OperatorClientError(
      0,
      "INVALID_API_PATH",
      "Dashboard API requests must use same-origin /api paths.",
    );
  }

  return path;
}
