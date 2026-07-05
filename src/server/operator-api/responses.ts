import { NextResponse } from "next/server";

import { isTransientInfrastructureError } from "../runtime-diagnostics";
import { OperatorApiError } from "./errors";
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
    console.error("Operator API infrastructure dependency failed.");

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

  console.error("Operator API operation failed.");

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
