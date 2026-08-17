import type { NextRequest } from "next/server";

import {
  jsonResponse,
  publicApiErrorResponse,
} from "@/server/public-api/responses";
import { PARTICIPANT_CREDENTIAL_COOKIE } from "@/server/session-api/participant-credential";
import { requireSessionApiRateLimit } from "@/server/session-api/rate-limit";
import { getPublicSessionParticipant } from "@/server/session-api/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  try {
    requireSessionApiRateLimit(request);
    const { token } = await context.params;
    const participant = await getPublicSessionParticipant(
      token,
      request.cookies.get(PARTICIPANT_CREDENTIAL_COOKIE)?.value,
    );
    return jsonResponse({ participant });
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
