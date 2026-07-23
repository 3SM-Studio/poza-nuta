import {
  invalidJsonResponse,
  jsonResponse,
  publicApiErrorResponse,
  validationErrorResponse,
} from "@/server/public-api/responses";
import { requireSessionApiRateLimit } from "@/server/session-api/rate-limit";
import { createPublicSessionRequest } from "@/server/session-api/service";
import { validateSessionRequestInput } from "@/server/session-api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidJsonResponse();
  }

  const validation = validateSessionRequestInput(body);
  if (!validation.success) return validationErrorResponse(validation.issues);

  try {
    requireSessionApiRateLimit(request);
    const { token } = await context.params;
    const createdRequest = await createPublicSessionRequest(token, validation.data);
    return jsonResponse({ request: createdRequest }, 201);
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
