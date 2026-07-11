import { legacyGoneResponse } from "../../../../server/legacy-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return legacyGoneResponse(
    "PUBLIC_ACTIVE_EVENT_ENDPOINT_GONE",
    "Use /api/public/events or /api/session/[code]/event.",
  );
}
