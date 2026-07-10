import { OperatorApiError } from "../operator-api/errors.ts";
import {
  getPlatformBootstrapStateFromStore,
  type PlatformSetupStore,
  verifySetupTokenHash,
} from "./core.ts";
import type { PlatformSetupInviteInput } from "./validation.ts";

export type PlatformSetupInviteAdmin = {
  inviteUserByEmail(
    email: string,
    options: { redirectTo: string },
  ): Promise<{ error: unknown | null }>;
};

export async function invitePlatformSetupUser(
  input: PlatformSetupInviteInput,
  dependencies: {
    store: Pick<PlatformSetupStore, "getBootstrapCounts">;
    admin: PlatformSetupInviteAdmin;
    redirectTo: string;
    setupTokenHash: string | undefined;
  },
) {
  const bootstrapState = await getPlatformBootstrapStateFromStore(
    dependencies.store,
  );

  if (bootstrapState.state !== "uninitialized") {
    throw new OperatorApiError(
      409,
      "PLATFORM_SETUP_UNAVAILABLE",
      "Platform setup is not available.",
    );
  }

  if (!verifySetupTokenHash(input.setupToken, dependencies.setupTokenHash)) {
    throw new OperatorApiError(
      400,
      "SETUP_TOKEN_INVALID",
      "Setup could not be completed.",
    );
  }

  const result = await dependencies.admin.inviteUserByEmail(input.email, {
    redirectTo: dependencies.redirectTo,
  });

  if (result.error) {
    throw new OperatorApiError(
      400,
      "SETUP_INVITE_FAILED",
      "Setup invitation could not be sent.",
    );
  }
}
