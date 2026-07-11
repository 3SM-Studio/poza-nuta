import { legacyGoneResponse } from "../../../../../../server/legacy-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST() {
  return legacyGoneResponse(
    "DASHBOARD_QUEUE_ACTION_ENDPOINT_GONE",
    "Use the event-scoped dashboard queue API.",
  );
}
