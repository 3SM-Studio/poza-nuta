import type { NextRequest } from "next/server";

import {
  operatorApiErrorResponse,
  operatorJsonResponse,
} from "../../../../server/operator-api/responses";
import { requireOperatorSession } from "../../../../server/operator-api/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await requireOperatorSession(request);

    return operatorJsonResponse({
      operator: session.operator,
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    return operatorApiErrorResponse(error);
  }
}
