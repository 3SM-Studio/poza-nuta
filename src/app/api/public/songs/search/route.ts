import {
  jsonResponse,
  publicApiErrorResponse,
  validationErrorResponse,
} from "../../../../../server/public-api/responses";
import { searchPublicSongs } from "../../../../../server/public-api/service";
import { validateSongSearchRequest } from "../../../../../server/public-api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const validation = validateSongSearchRequest(url.searchParams);

  if (!validation.success) {
    return validationErrorResponse(validation.issues);
  }

  try {
    const page = await searchPublicSongs(
      validation.data.query,
      validation.data.cursor,
    );

    return jsonResponse(page);
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
