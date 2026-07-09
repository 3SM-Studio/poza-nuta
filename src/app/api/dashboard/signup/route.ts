import type { NextRequest } from "next/server";

import {
  operatorApiErrorResponse,
  operatorInvalidJsonResponse,
  operatorJsonResponse,
  operatorValidationErrorResponse,
} from "../../../../server/operator-api/responses";
import {
  AuthRedirectConfigurationError,
  buildAuthCallbackRedirectTo,
  getAuthRedirectOrigin,
} from "../../../../lib/auth-redirects";
import { signupOperator } from "../../../../server/operator-api/supabase-session";
import { validateSignupInput } from "../../../../server/operator-api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return operatorInvalidJsonResponse();
  }

  const validation = validateSignupInput(body);

  if (!validation.success) {
    return operatorValidationErrorResponse(validation.issues);
  }

  try {
    const requestOrigin = new URL(request.url).origin;
    const signup = await signupOperator({
      data: validation.data,
      emailRedirectTo: buildAuthCallbackRedirectTo(
        getAuthRedirectOrigin(requestOrigin),
      ),
    });

    return operatorJsonResponse({
      status: signup.status,
      operator: signup.operator,
    });
  } catch (error) {
    if (error instanceof AuthRedirectConfigurationError) {
      return operatorJsonResponse(
        {
          error: {
            code: "AUTH_CONFIGURATION_ERROR",
            message: "Authentication redirect configuration is invalid.",
          },
        },
        503,
      );
    }

    return operatorApiErrorResponse(error);
  }
}
