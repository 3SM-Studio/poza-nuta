import type { NextRequest } from "next/server";

import { createAdminClient } from "../../../../lib/supabase/admin";
import { OperatorApiError } from "../../../../server/operator-api/errors";
import {
  operatorApiErrorResponse,
  operatorInvalidJsonResponse,
  operatorJsonResponse,
  operatorValidationErrorResponse,
} from "../../../../server/operator-api/responses";
import {
  getConfiguredSiteOrigin,
  getRateLimitKey,
  requireSameOriginRequest,
} from "../../../../server/setup/http";
import { invitePlatformSetupUser } from "../../../../server/setup/invite";
import { consumeSetupRateLimit } from "../../../../server/setup/rate-limit";
import { getPlatformBootstrapState } from "../../../../server/setup/service";
import { validatePlatformSetupInviteInput } from "../../../../server/setup/validation";

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

  const validation = validatePlatformSetupInviteInput(body);

  if (!validation.success) {
    return operatorValidationErrorResponse(validation.issues);
  }

  const limit = consumeSetupRateLimit({
    scope: "setup-invite",
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
    const origin = getConfiguredSiteOrigin();

    await invitePlatformSetupUser(validation.data, {
      store: {
        getBootstrapCounts: async () =>
          (await getPlatformBootstrapState()).counts,
      },
      admin: {
        inviteUserByEmail: (email, options) => {
          const admin = createAdminClient();

          return admin.auth.admin.inviteUserByEmail(email, options);
        },
      },
      redirectTo: new URL("/auth/invite", origin).toString(),
      setupTokenHash: process.env.PLATFORM_SETUP_TOKEN_SHA256,
    });

    return operatorJsonResponse({ status: "check_email" as const });
  } catch (error) {
    return operatorApiErrorResponse(error);
  }
}
