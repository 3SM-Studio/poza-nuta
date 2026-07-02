import "server-only";

import type { NextRequest } from "next/server";

import {
  operatorApiErrorResponse,
  operatorJsonResponse,
  operatorValidationErrorResponse,
} from "./responses";
import { requireOperatorSession } from "./supabase-session";
import { applyOperatorQueueAction } from "./service";
import type { OperatorQueueAction } from "./transitions";
import { validateRequestId } from "./validation";

export async function handleOperatorQueueAction(
  _request: NextRequest,
  params: Promise<{ requestId: string }>,
  action: OperatorQueueAction,
) {
  try {
    const session = await requireOperatorSession();
    const { requestId: rawRequestId } = await params;
    const validation = validateRequestId(rawRequestId);

    if (!validation.success) {
      return operatorValidationErrorResponse(validation.issues);
    }

    const result = await applyOperatorQueueAction(
      action,
      validation.data,
      session.operator.id,
    );

    return operatorJsonResponse(result);
  } catch (error) {
    return operatorApiErrorResponse(error);
  }
}
