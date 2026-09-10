import { legacyGoneResponse } from "../../../../server/legacy-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return legacyGoneResponse(
    "PUBLIC_QUEUE_ENDPOINT_GONE",
    "Participant queue access requires a session code. Use /api/session/[code]/queue.",
  );
}
