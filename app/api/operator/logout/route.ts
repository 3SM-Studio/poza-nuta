import type { NextRequest } from "next/server";

import {
  operatorApiErrorResponse,
  operatorJsonResponse,
} from "../../../../server/operator-api/responses";
import {
  clearOperatorSessionCookie,
  logoutOperator,
  requireOperatorSession,
} from "../../../../server/operator-api/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await requireOperatorSession(request);
    await logoutOperator(session);

    const response = operatorJsonResponse({ success: true });
    clearOperatorSessionCookie(response);
    return response;
  } catch (error) {
    return operatorApiErrorResponse(error);
  }
}
