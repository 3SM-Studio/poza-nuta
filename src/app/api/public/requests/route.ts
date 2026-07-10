import { jsonResponse } from "../../../../server/public-api/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return jsonResponse(
    {
      error: {
        code: "PUBLIC_REQUEST_ENDPOINT_GONE",
        message: "Use /api/public/events/[slug]/requests.",
      },
    },
    410,
  );
}
