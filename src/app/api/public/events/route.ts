import {
  jsonResponse,
  publicApiErrorResponse,
} from "../../../../server/public-api/responses";
import { listPublicEvents } from "../../../../server/public-api/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const events = await listPublicEvents("public.events", {
      q: url.searchParams.get("q"),
      city: url.searchParams.get("city"),
      date: url.searchParams.get("date"),
      phase: url.searchParams.get("phase"),
      sort: url.searchParams.get("sort"),
    });

    return jsonResponse({ events });
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
