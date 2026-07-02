import type { NextRequest } from "next/server";

import { handleOperatorQueueAction } from "../../../../../../server/operator-api/route-handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> },
) {
  return handleOperatorQueueAction(request, context.params, "done");
}
