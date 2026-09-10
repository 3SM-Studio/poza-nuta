import type { NextRequest } from "next/server";

import { OperatorApiError } from "../../../../server/operator-api/errors";
import {
  operatorApiErrorResponse,
  operatorInvalidJsonResponse,
  operatorJsonResponse,
  operatorValidationErrorResponse,
} from "../../../../server/operator-api/responses";
import { getVerifiedSetupUserFromRequest } from "../../../../server/setup/auth";
import {
  getRateLimitKey,
  requireSameOriginRequest,
} from "../../../../server/setup/http";
import { consumeSetupRateLimit } from "../../../../server/setup/rate-limit";
import { completePlatformSetup } from "../../../../server/setup/service";
import { validatePlatformSetupInput } from "../../../../server/setup/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    requireSameOriginRequest(request);
  } catch (error) {
    return operatorApiErrorResponse(error);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return operatorInvalidJsonResponse();
  }

  const validation = validatePlatformSetupInput(body);

  if (!validation.success) {
    return operatorValidationErrorResponse(validation.issues);
  }

  const limit = consumeSetupRateLimit({
    scope: "setup-token",
    key: getRateLimitKey(request),
  });

  if (!limit.allowed) {
    return operatorApiErrorResponse(
      new OperatorApiError(
        429,
        "SETUP_RATE_LIMITED",
        "Too many attempts. Try again later.",
      ),
    );
  }

  try {
    await completePlatformSetup({
      data: validation.data,
      getVerifiedUser: getVerifiedSetupUserFromRequest,
    });

    return operatorJsonResponse({ success: true });
  } catch (error) {
    return operatorApiErrorResponse(error);
  }
}
