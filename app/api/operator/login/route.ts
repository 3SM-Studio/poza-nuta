import type { NextRequest } from "next/server";

import {
  operatorApiErrorResponse,
  operatorInvalidJsonResponse,
  operatorJsonResponse,
  operatorValidationErrorResponse,
} from "../../../../server/operator-api/responses";
import {
  loginOperator,
  setOperatorSessionCookie,
} from "../../../../server/operator-api/session";
import { validateLoginInput } from "../../../../server/operator-api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return operatorInvalidJsonResponse();
  }

  const validation = validateLoginInput(body);

  if (!validation.success) {
    return operatorValidationErrorResponse(validation.issues);
  }

  try {
    const login = await loginOperator(validation.data);
    const response = operatorJsonResponse({
      operator: login.session.operator,
      expiresAt: login.session.expiresAt,
    });

    setOperatorSessionCookie(response, login.token);
    return response;
  } catch (error) {
    return operatorApiErrorResponse(error);
  }
}
