import { extendActiveEvent } from "../../../../../server/event-lifecycle";
import {
  operatorApiErrorResponse,
  operatorInvalidJsonResponse,
  operatorJsonResponse,
  operatorValidationErrorResponse,
} from "../../../../../server/operator-api/responses";
import { requireOperatorSession } from "../../../../../server/operator-api/supabase-session";
import { validateExtendInput } from "../../../../../server/operator-api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let session: Awaited<ReturnType<typeof requireOperatorSession>>;

  try {
    session = await requireOperatorSession();
  } catch (error) {
    return operatorApiErrorResponse(error);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return operatorInvalidJsonResponse();
  }

  const validation = validateExtendInput(body);

  if (!validation.success) {
    return operatorValidationErrorResponse(validation.issues);
  }

  try {
    const event = await extendActiveEvent(
      validation.data,
      session.operator.id,
    );

    return operatorJsonResponse({ event });
  } catch (error) {
    return operatorApiErrorResponse(error);
  }
}
