import { legacyGoneResponse } from "../../../../server/legacy-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return legacyGoneResponse(
    "PUBLIC_REQUEST_ENDPOINT_GONE",
    "Song requests require a session code. Use /api/session/[code]/requests.",
  );
}
