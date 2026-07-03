import { revokeActiveEventAccessLink } from "../../../../../../../server/operator-api/access-links-service";
import {
  operatorApiErrorResponse,
  operatorJsonResponse,
  operatorValidationErrorResponse,
} from "../../../../../../../server/operator-api/responses";
import { requireOperatorSession } from "../../../../../../../server/operator-api/supabase-session";
import { validateAccessLinkId } from "../../../../../../../server/operator-api/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ linkId: string }> },
) {
  try {
    const session = await requireOperatorSession();
    const { linkId: rawLinkId } = await context.params;
    const validation = validateAccessLinkId(rawLinkId);

    if (!validation.success) {
      return operatorValidationErrorResponse(validation.issues);
    }

    const result = await revokeActiveEventAccessLink(
      validation.data,
      session.operator.id,
    );

    return operatorJsonResponse(result);
  } catch (error) {
    return operatorApiErrorResponse(error);
  }
}
