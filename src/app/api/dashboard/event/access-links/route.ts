import {
  createActiveEventAccessLink,
  listActiveEventAccessLinks,
} from "../../../../../server/operator-api/access-links-service";
import {
  operatorApiErrorResponse,
  operatorInvalidJsonResponse,
  operatorJsonResponse,
  operatorValidationErrorResponse,
} from "../../../../../server/operator-api/responses";
import { requireOperatorSession } from "../../../../../server/operator-api/supabase-session";
import { validateCreateEventAccessLinkInput } from "../../../../../server/operator-api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireOperatorSession();
    const result = await listActiveEventAccessLinks();

    return operatorJsonResponse(result);
  } catch (error) {
    return operatorApiErrorResponse(error);
  }
}

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

  const validation = validateCreateEventAccessLinkInput(body);

  if (!validation.success) {
    return operatorValidationErrorResponse(validation.issues);
  }

  try {
    const result = await createActiveEventAccessLink(
      validation.data,
      session.operator.id,
    );

    return operatorJsonResponse(result, 201);
  } catch (error) {
    return operatorApiErrorResponse(error);
  }
}
