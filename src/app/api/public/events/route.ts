import {
  jsonResponse,
  publicApiErrorResponse,
} from "../../../../server/public-api/responses";
import { listPublicEvents } from "../../../../server/public-api/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const events = await listPublicEvents("public.events");

    return jsonResponse({ events });
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
