import {
  operatorApiErrorResponse,
  operatorJsonResponse,
} from "../../../../server/operator-api/responses";
import { requireOperatorSession } from "../../../../server/operator-api/supabase-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireOperatorSession("dashboard.me");

    return operatorJsonResponse({
      operator: session.operator,
      authUser: session.authUser,
    });
  } catch (error) {
    return operatorApiErrorResponse(error);
  }
}
