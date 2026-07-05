import {
  jsonResponse,
  publicApiErrorResponse,
} from "../../../../../server/public-api/responses";
import { getSessionQueue } from "../../../../../server/session-api/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    const queue = await getSessionQueue(code);

    return jsonResponse(queue);
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
