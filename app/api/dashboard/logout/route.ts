import {
  operatorApiErrorResponse,
  operatorJsonResponse,
} from "../../../../server/operator-api/responses";
import { logoutOperator } from "../../../../server/operator-api/supabase-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    await logoutOperator();

    return operatorJsonResponse({ success: true });
  } catch (error) {
    return operatorApiErrorResponse(error);
  }
}
