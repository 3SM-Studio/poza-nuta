import {
  operatorApiErrorResponse,
  operatorJsonResponse,
} from "../../../../server/operator-api/responses";
import { requireOperatorSession } from "../../../../server/operator-api/supabase-session";
import { getOperatorQueue } from "../../../../server/operator-api/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireOperatorSession();
    const queue = await getOperatorQueue();

    return operatorJsonResponse(queue);
  } catch (error) {
    return operatorApiErrorResponse(error);
  }
}
