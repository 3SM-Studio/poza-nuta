import { NextResponse } from "next/server";

import {
  getSafeErrorCode,
  getSafeErrorMessage,
  isTransientInfrastructureError,
} from "../runtime-diagnostics.ts";
import { OperatorApiError } from "./errors.ts";
import type { ValidationIssue } from "./validation";

type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    issues?: ValidationIssue[];
  };
};

export function operatorJsonResponse<T>(body: T, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export function operatorValidationErrorResponse(issues: ValidationIssue[]) {
  return operatorJsonResponse<ApiErrorBody>(
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

export function operatorInvalidJsonResponse() {
  return operatorJsonResponse<ApiErrorBody>(
    {
      error: {
        code: "INVALID_JSON",
        message: "Request body must contain valid JSON.",
      },
    },
    400,
  );
}

export function operatorApiErrorResponse(error: unknown) {
  if (error instanceof OperatorApiError) {
    return operatorJsonResponse<ApiErrorBody>(
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
    logOperatorApiError("operator_api_infrastructure_failure", error);

    return operatorJsonResponse<ApiErrorBody>(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "The service is temporarily unavailable.",
        },
      },
      503,
    );
  }

  logOperatorApiError("operator_api_operation_failed", error);

  return operatorJsonResponse<ApiErrorBody>(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
      },
    },
    500,
  );
}

function logOperatorApiError(scope: string, error: unknown) {
  console.error(
    [
      scope,
      `error_code=${JSON.stringify(getSafeErrorCode(error))}`,
      `error_message=${JSON.stringify(getSafeErrorMessage(error))}`,
    ].join(" "),
  );
}
