import {
  jsonResponse,
  publicApiErrorResponse,
  validationErrorResponse,
} from "@/server/public-api/responses";
import { validateSongSearchRequest } from "@/server/public-api/validation";
import { requireSessionApiRateLimit } from "@/server/session-api/rate-limit";
import { searchPublicSessionSongs } from "@/server/session-api/service";
import { runWithDbTelemetry } from "@/server/db-telemetry";

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
    requireSessionApiRateLimit(request, "search");
    const { token } = await context.params;
    const page = await runWithDbTelemetry("session_token_songs_search", () => searchPublicSessionSongs(
      token,
      validation.data.query,
      validation.data.cursor,
    ));
    return jsonResponse(page);
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
