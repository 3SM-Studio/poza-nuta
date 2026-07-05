import { isTransientInfrastructureError } from "../runtime-diagnostics";
import { PublicApiError } from "./errors";

type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    issues?: ValidationIssue[];
  };
};

export type ValidationIssue = {
  field: string;
  message: string;
};

export function jsonResponse<T>(body: T, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export function validationErrorResponse(issues: ValidationIssue[]) {
  return jsonResponse<ApiErrorBody>(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        issues,
      },
    },
    400,
  );
}

export function invalidJsonResponse() {
  return jsonResponse<ApiErrorBody>(
    {
      error: {
        code: "INVALID_JSON",
        message: "Request body must contain valid JSON.",
      },
    },
    400,
  );
}

export function publicApiErrorResponse(error: unknown) {
  if (error instanceof PublicApiError) {
    return jsonResponse<ApiErrorBody>(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      error.status,
    );
  }

  if (isTransientInfrastructureError(error)) {
    console.error("Public API infrastructure dependency failed.");

    return jsonResponse<ApiErrorBody>(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "The service is temporarily unavailable.",
        },
      },
      503,
    );
  }

  console.error("Public API operation failed.");

  return jsonResponse<ApiErrorBody>(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
      },
    },
    500,
  );
}
