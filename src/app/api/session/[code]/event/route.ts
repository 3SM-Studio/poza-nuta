import {
  jsonResponse,
  publicApiErrorResponse,
} from "../../../../../server/public-api/responses";
import { getSessionEvent } from "../../../../../server/session-api/service";
import { requireSessionApiRateLimit } from "../../../../../server/session-api/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    requireSessionApiRateLimit(request);
    const { code } = await context.params;
    const result = await getSessionEvent(code);

    return jsonResponse(result);
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
