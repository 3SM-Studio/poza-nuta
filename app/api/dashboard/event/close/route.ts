import { closeActiveEvent } from "../../../../../server/event-lifecycle";
import {
  operatorApiErrorResponse,
  operatorJsonResponse,
} from "../../../../../server/operator-api/responses";
import { requireOperatorSession } from "../../../../../server/operator-api/supabase-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    const session = await requireOperatorSession();
    const event = await closeActiveEvent(session.operator.id);

    return operatorJsonResponse({ event });
  } catch (error) {
    return operatorApiErrorResponse(error);
  }
}
