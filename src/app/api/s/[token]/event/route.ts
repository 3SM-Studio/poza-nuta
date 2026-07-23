import { jsonResponse, publicApiErrorResponse } from "@/server/public-api/responses";
import { requireSessionApiRateLimit } from "@/server/session-api/rate-limit";
import { getPublicSessionEvent } from "@/server/session-api/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    requireSessionApiRateLimit(request);
    const { token } = await context.params;
    return jsonResponse(await getPublicSessionEvent(token));
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
