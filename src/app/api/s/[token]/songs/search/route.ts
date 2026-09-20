import {
  jsonResponse,
  publicApiErrorResponse,
  validationErrorResponse,
} from "@/server/public-api/responses";
import { validateSongSearchRequest } from "@/server/public-api/validation";
import { requireSessionApiRateLimit } from "@/server/session-api/rate-limit";
import { searchPublicSessionSongs } from "@/server/session-api/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const validation = validateSongSearchRequest(
    new URL(request.url).searchParams,
  );
  if (!validation.success) return validationErrorResponse(validation.issues);

  try {
    requireSessionApiRateLimit(request);
    const { token } = await context.params;
    const page = await searchPublicSessionSongs(
      token,
      validation.data.query,
      validation.data.cursor,
    );
    return jsonResponse(page);
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
