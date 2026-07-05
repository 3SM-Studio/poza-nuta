export type LinkedOperatorRecord = {
  id: number;
  name: string;
  active: boolean;
};

export type OperatorAccessDecision =
  | {
      allowed: true;
      operator: LinkedOperatorRecord & { active: true };
    }
  | {
      allowed: false;
      status: 401 | 403;
      code:
        | "AUTHENTICATION_REQUIRED"
        | "OPERATOR_NOT_LINKED"
        | "OPERATOR_INACTIVE";
      message: string;
    };

export type SignInPageAccessDecision =
  | {
      state: "guest";
    }
  | {
      state: "authorized";
      operator: LinkedOperatorRecord & { active: true };
    }
  | {
      state: "unauthorized";
      code: "OPERATOR_NOT_LINKED" | "OPERATOR_INACTIVE";
    };

export function resolveOperatorAccess(
  authUserId: string | null,
  operator: LinkedOperatorRecord | null,
): OperatorAccessDecision {
  if (!authUserId) {
    return {
      allowed: false,
      status: 401,
      code: "AUTHENTICATION_REQUIRED",
      message: "A valid Supabase Auth session is required.",
    };
  }

  if (!operator) {
    return {
      allowed: false,
      status: 403,
      code: "OPERATOR_NOT_LINKED",
      message: "This account is not linked to an operator.",
    };
  }

  if (!operator.active) {
    return {
      allowed: false,
      status: 403,
      code: "OPERATOR_INACTIVE",
      message: "This operator account is inactive.",
    };
  }

  return {
    allowed: true,
    operator: {
      ...operator,
      active: true,
    },
  };
}

export function resolveSignInPageAccess(
  authUserId: string | null,
  operator: LinkedOperatorRecord | null,
): SignInPageAccessDecision {
  if (!authUserId) {
    return { state: "guest" };
  }

  const access = resolveOperatorAccess(authUserId, operator);

  if (access.allowed) {
    return {
      state: "authorized",
      operator: access.operator,
    };
  }

  return {
    state: "unauthorized",
    code:
      access.code === "OPERATOR_INACTIVE"
        ? "OPERATOR_INACTIVE"
        : "OPERATOR_NOT_LINKED",
  };
}

type SupabaseAuthErrorLike = {
  code?: string;
  status?: number;
};

export type LoginAuthErrorDecision = {
  status: 401 | 429 | 503;
  code: "INVALID_CREDENTIALS" | "AUTH_RATE_LIMITED" | "AUTH_SERVICE_ERROR";
  message: string;
};

export function mapSupabaseLoginError(
  error: SupabaseAuthErrorLike,
): LoginAuthErrorDecision {
  if (
    error.code === "over_request_rate_limit" ||
    error.code === "over_email_send_rate_limit" ||
    error.status === 429
  ) {
    return {
      status: 429,
      code: "AUTH_RATE_LIMITED",
      message: "Too many login attempts. Try again later.",
    };
  }

  if (
    error.code === "invalid_credentials" ||
    error.code === "email_not_confirmed" ||
    error.code === "user_banned" ||
    error.status === 400
  ) {
    return {
      status: 401,
      code: "INVALID_CREDENTIALS",
      message: "The email address or password is incorrect.",
    };
  }

  return {
    status: 503,
    code: "AUTH_SERVICE_ERROR",
    message: "Authentication is temporarily unavailable.",
  };
}
