import type { NextRequest } from "next/server";

import {
  operatorApiErrorResponse,
  operatorJsonResponse,
} from "../../../../server/operator-api/responses";
import { requireOperatorSession } from "../../../../server/operator-api/session";
import { getOperatorQueue } from "../../../../server/operator-api/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requireOperatorSession(request);
    const queue = await getOperatorQueue();

    return operatorJsonResponse(queue);
  } catch (error) {
    return operatorApiErrorResponse(error);
  }
}
