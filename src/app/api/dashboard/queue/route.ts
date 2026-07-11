import { legacyGoneResponse } from "../../../../server/legacy-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return legacyGoneResponse(
    "DASHBOARD_QUEUE_ENDPOINT_GONE",
    "Use /api/dashboard/organizations/[organizationId]/events/[eventId]/queue.",
  );
}
