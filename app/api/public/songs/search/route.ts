import {
  jsonResponse,
  publicApiErrorResponse,
  validationErrorResponse,
} from "../../../../../server/public-api/responses";
import { searchPublicSongs } from "../../../../../server/public-api/service";
import { validateSearchQuery } from "../../../../../server/public-api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const validation = validateSearchQuery(url.searchParams.get("q"));

  if (!validation.success) {
    return validationErrorResponse(validation.issues);
  }

  try {
    const songs = await searchPublicSongs(validation.data);

    return jsonResponse({ items: songs });
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
