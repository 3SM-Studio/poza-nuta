import {
  jsonResponse,
  publicApiErrorResponse,
} from "../../../../server/public-api/responses";
import { getActivePublicEvent } from "../../../../server/public-api/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const event = await getActivePublicEvent("public.event");

    return jsonResponse({ event });
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
