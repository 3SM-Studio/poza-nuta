import {
  jsonResponse,
  publicApiErrorResponse,
  validationErrorResponse,
} from "../../../../../../server/public-api/responses";
import { validateSongSearchRequest } from "../../../../../../server/public-api/validation";
import { searchSessionSongs } from "../../../../../../server/session-api/service";
import { requireSessionApiRateLimit } from "../../../../../../server/session-api/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const url = new URL(request.url);
  const validation = validateSongSearchRequest(url.searchParams);

  if (!validation.success) {
    return validationErrorResponse(validation.issues);
  }

  try {
    requireSessionApiRateLimit(request);
    const { code } = await context.params;
    const page = await searchSessionSongs(
      code,
      validation.data.query,
      validation.data.cursor,
    );

    return jsonResponse(page);
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
