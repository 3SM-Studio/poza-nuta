import type { NextRequest } from "next/server";

import {
  operatorApiErrorResponse,
  operatorInvalidJsonResponse,
  operatorJsonResponse,
  operatorValidationErrorResponse,
} from "../../../../server/operator-api/responses";
import { buildAuthCallbackRedirectTo } from "../../../../lib/auth-redirects";
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
    const signup = await signupOperator({
      data: validation.data,
      emailRedirectTo: buildAuthCallbackRedirectTo(new URL(request.url).origin),
    });

    return operatorJsonResponse({
      status: signup.status,
      operator: signup.operator,
    });
  } catch (error) {
    return operatorApiErrorResponse(error);
  }
}
