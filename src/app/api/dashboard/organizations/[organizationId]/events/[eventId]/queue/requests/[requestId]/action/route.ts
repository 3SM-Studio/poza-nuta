import {
  applyDashboardOrganizationEventQueueActionForAuthUser,
} from "@/server/operator-api/event-queue";
import {
  validateDashboardEventQueueActionInput,
} from "@/server/operator-api/event-queue-validation";
import {
  operatorApiErrorResponse,
  operatorInvalidJsonResponse,
  operatorJsonResponse,
  operatorValidationErrorResponse,
} from "@/server/operator-api/responses";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";
import {
  validateEventId,
  validateRequestId,
} from "@/server/operator-api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      organizationId: string;
      eventId: string;
      requestId: string;
    }>;
  },
) {
  try {
    const session = await requireOperatorSession();
    const {
      organizationId,
      eventId: rawEventId,
      requestId: rawRequestId,
    } = await context.params;
    const eventIdValidation = validateEventId(rawEventId);
    const requestIdValidation = validateRequestId(rawRequestId);

    if (!eventIdValidation.success) {
      return operatorValidationErrorResponse(eventIdValidation.issues);
    }

    if (!requestIdValidation.success) {
      return operatorValidationErrorResponse(requestIdValidation.issues);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return operatorInvalidJsonResponse();
    }

    const actionValidation = validateDashboardEventQueueActionInput(body);

    if (!actionValidation.success) {
      return operatorValidationErrorResponse(actionValidation.issues);
    }

    const result =
      await applyDashboardOrganizationEventQueueActionForAuthUser({
        authUserId: session.authUser.id,
        organizationId,
        eventId: eventIdValidation.data,
        requestId: requestIdValidation.data,
        action: actionValidation.data,
      });

    return operatorJsonResponse(result);
  } catch (error) {
    return operatorApiErrorResponse(error);
  }
}
