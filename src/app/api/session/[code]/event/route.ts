import {
  jsonResponse,
  publicApiErrorResponse,
} from "../../../../../server/public-api/responses";
import { getSessionEvent } from "../../../../../server/session-api/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    const result = await getSessionEvent(code);

    return jsonResponse(result);
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
