import { legacyGoneResponse } from "../../../../../server/legacy-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return legacyGoneResponse(
    "SESSION_REQUEST_ENDPOINT_GONE",
    "Song requests require a joined participant session. Use /api/s/[token]/requests.",
  );
}
