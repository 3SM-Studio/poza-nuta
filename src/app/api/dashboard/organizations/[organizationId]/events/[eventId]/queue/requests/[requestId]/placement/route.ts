import { placeDashboardEventQueueRequestForAuthUser } from "@/server/operator-api/event-queue";
import type { NextRequest } from "next/server";
import { validateQueuePlacementInput } from "@/server/operator-api/event-queue-validation";
import { runEventParticipantRoute } from "@/server/operator-api/event-participants-http";
import { readIdentityBody } from "@/server/session-api/identity-http";
import { OperatorApiError } from "@/server/operator-api/errors";
import { validateRequestId } from "@/server/operator-api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, context: {
  params: Promise<{ organizationId: string; eventId: string; requestId: string }>;
}) {
  return runEventParticipantRoute(request, context, async scope => {
    const params = await context.params;
    const id = validateRequestId(params.requestId);
    if (!id.success) throw new OperatorApiError(400, "VALIDATION_ERROR", "Invalid request identifier.");
    const body = await readIdentityBody(request, 260_000);
    const placement = validateQueuePlacementInput(body);
    if (!placement.success) throw new OperatorApiError(400, "VALIDATION_ERROR", "Invalid queue placement.");
    return placeDashboardEventQueueRequestForAuthUser({ ...scope, requestId: id.data, placement: placement.data });
  });
}
