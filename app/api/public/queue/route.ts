import {
  jsonResponse,
  publicApiErrorResponse,
} from "../../../../server/public-api/responses";
import { getPublicQueue } from "../../../../server/public-api/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const queue = await getPublicQueue();

    return jsonResponse(queue);
  } catch (error) {
    return publicApiErrorResponse(error);
  }
}
