import {
  jsonResponse,
  publicApiErrorResponse,
  validationErrorResponse,
} from "@/server/public-api/responses";
import { validateSearchQuery } from "@/server/public-api/validation";
import { requireSessionApiRateLimit } from "@/server/session-api/rate-limit";
import { searchPublicSessionSongs } from "@/server/session-api/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const validation = validateSearchQuery(
    new URL(request.url).searchParams.get("q"),
  );
  if (!validation.success) return validationErrorResponse(validation.issues);

  try {
    requireSessionApiRateLimit(request);
    const { token } = await context.params;
    const songs = await searchPublicSessionSongs(token, validation.data);
    return jsonResponse({ items: songs });
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
