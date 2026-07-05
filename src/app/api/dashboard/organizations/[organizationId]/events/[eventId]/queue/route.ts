import { OperatorApiError } from "@/server/operator-api/errors";
import { getDashboardOrganizationEventQueueForAuthUser } from "@/server/operator-api/event-queue";
import {
  operatorApiErrorResponse,
  operatorJsonResponse,
  operatorValidationErrorResponse,
} from "@/server/operator-api/responses";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";
import { validateEventId } from "@/server/operator-api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      organizationId: string;
      eventId: string;
    }>;
  },
) {
  try {
    const session = await requireOperatorSession();
    const { organizationId, eventId: rawEventId } = await context.params;
    const eventIdValidation = validateEventId(rawEventId);

    if (!eventIdValidation.success) {
      return operatorValidationErrorResponse(eventIdValidation.issues);
    }

    const result = await getDashboardOrganizationEventQueueForAuthUser({
      authUserId: session.authUser.id,
      organizationId,
      eventId: eventIdValidation.data,
    });

    if (!result) {
      throw new OperatorApiError(
        404,
        "EVENT_NOT_FOUND",
        "Event was not found.",
      );
    }

    return operatorJsonResponse(result);
  } catch (error) {
    return operatorApiErrorResponse(error);
  }
}
