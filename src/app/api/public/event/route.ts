import {
  jsonResponse,
  publicApiErrorResponse,
} from "../../../../server/public-api/responses";
import { getActivePublicEvent } from "../../../../server/public-api/service";
import { traceServerStep } from "../../../../server/runtime-diagnostics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const event = await traceServerStep("public.event", "getActiveEvent", () =>
      getActivePublicEvent(),
    );

    return jsonResponse({ event });
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
