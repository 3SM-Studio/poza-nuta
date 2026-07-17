import {
  jsonResponse,
  publicApiErrorResponse,
  validationErrorResponse,
} from "../../../../../../server/public-api/responses";
import { validateSearchQuery } from "../../../../../../server/public-api/validation";
import { searchSessionSongs } from "../../../../../../server/session-api/service";
import { requireSessionApiRateLimit } from "../../../../../../server/session-api/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const url = new URL(request.url);
  const validation = validateSearchQuery(url.searchParams.get("q"));

  if (!validation.success) {
    return validationErrorResponse(validation.issues);
  }

  try {
    requireSessionApiRateLimit(request);
    const { code } = await context.params;
    const songs = await searchSessionSongs(code, validation.data);

    return jsonResponse({ items: songs });
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
