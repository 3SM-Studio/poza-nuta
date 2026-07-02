import type { NextRequest } from "next/server";

import {
  operatorApiErrorResponse,
  operatorInvalidJsonResponse,
  operatorJsonResponse,
  operatorValidationErrorResponse,
} from "../../../../server/operator-api/responses";
import { loginOperator } from "../../../../server/operator-api/supabase-session";
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

    return operatorJsonResponse({
      operator: login.operator,
    });
  } catch (error) {
    return operatorApiErrorResponse(error);
  }
}
