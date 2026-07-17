import {
  invalidJsonResponse,
  jsonResponse,
  publicApiErrorResponse,
  validationErrorResponse,
} from "../../../../../server/public-api/responses";
import { createSessionRequest } from "../../../../../server/session-api/service";
import { requireSessionApiRateLimit } from "../../../../../server/session-api/rate-limit";
import { validateSessionRequestInput } from "../../../../../server/session-api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return invalidJsonResponse();
  }

  const validation = validateSessionRequestInput(body);

  if (!validation.success) {
    return validationErrorResponse(validation.issues);
  }

  try {
    requireSessionApiRateLimit(request);
    const { code } = await context.params;
    const createdRequest = await createSessionRequest(code, validation.data);

    return jsonResponse({ request: createdRequest }, 201);
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
