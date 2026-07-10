import { createHash, timingSafeEqual } from "node:crypto";

import { OperatorApiError } from "../operator-api/errors.ts";
import type { PlatformSetupInput } from "./validation.ts";

export type PlatformBootstrapState =
  | {
      state: "uninitialized";
      counts: PlatformBootstrapCounts;
    }
  | {
      state: "initialized";
      counts: PlatformBootstrapCounts;
    }
  | {
      state: "inconsistent";
      counts: PlatformBootstrapCounts;
    };

export type PlatformBootstrapCounts = {
  platformMembers: number;
  activePlatformOwners: number;
  operatorUsers: number;
  workspaces: number;
  workspaceMembers: number;
  completeOwnerLinks: number;
  events: number;
  legacyWorkspaceId: number | null;
};

export type VerifiedSetupUser =
  | {
      status: "authenticated";
      id: string;
      email: string | null;
      emailConfirmed: boolean;
    }
  | {
      status: "missing";
    };

export type PlatformSetupStore = {
  acquireSetupLock(): Promise<void>;
  getBootstrapCounts(): Promise<PlatformBootstrapCounts>;
  createOperator(input: {
    authUserId: string;
    displayName: string;
    now: Date;
  }): Promise<{ id: number }>;
  createPlatformOwner(input: {
    operatorUserId: number;
    now: Date;
  }): Promise<void>;
  createWorkspace(input: {
    name: string;
    handle: string;
    now: Date;
    legacyWorkspaceId: number | null;
  }): Promise<{ id: number }>;
  createWorkspaceOwner(input: {
    workspaceId: number;
    operatorUserId: number;
    now: Date;
  }): Promise<void>;
  countEvents(): Promise<number>;
};

export type CompletePlatformSetupDependencies = {
  store: PlatformSetupStore;
  getVerifiedUser: () => Promise<VerifiedSetupUser>;
  setupTokenHash: string | undefined;
  now?: Date;
};

export type CompletePlatformSetupResult = {
  operatorUserId: number;
  workspaceId: number;
};

export async function completePlatformSetupWithStore(
  input: PlatformSetupInput,
  dependencies: CompletePlatformSetupDependencies,
): Promise<CompletePlatformSetupResult> {
  const now = dependencies.now ?? new Date();

  await dependencies.store.acquireSetupLock();

  const bootstrapState = await getPlatformBootstrapStateFromStore(
    dependencies.store,
  );

  if (bootstrapState.state === "initialized") {
    throw new OperatorApiError(
      409,
      "PLATFORM_ALREADY_INITIALIZED",
      "Platform setup is already complete.",
    );
  }

  if (bootstrapState.state === "inconsistent") {
    throw new OperatorApiError(
      409,
      "PLATFORM_SETUP_INCONSISTENT",
      "Platform setup cannot continue automatically.",
    );
  }

  const user = await dependencies.getVerifiedUser();

  if (user.status !== "authenticated") {
    throw new OperatorApiError(
      401,
      "AUTHENTICATION_REQUIRED",
      "A valid Supabase Auth session is required.",
    );
  }

  if (!user.emailConfirmed) {
    throw new OperatorApiError(
      403,
      "EMAIL_CONFIRMATION_REQUIRED",
      "Confirm your email before completing setup.",
    );
  }

  if (!verifySetupTokenHash(input.setupToken, dependencies.setupTokenHash)) {
    throw new OperatorApiError(
      400,
      "SETUP_TOKEN_INVALID",
      "Setup could not be completed.",
    );
  }

  const operator = await dependencies.store.createOperator({
    authUserId: user.id,
    displayName: input.displayName,
    now,
  });
  await dependencies.store.createPlatformOwner({
    operatorUserId: operator.id,
    now,
  });
  const workspace = await dependencies.store.createWorkspace({
    name: input.workspaceName,
    handle: input.workspaceHandle,
    now,
    legacyWorkspaceId: bootstrapState.counts.legacyWorkspaceId,
  });
  await dependencies.store.createWorkspaceOwner({
    workspaceId: workspace.id,
    operatorUserId: operator.id,
    now,
  });

  const eventCount = await dependencies.store.countEvents();

  if (eventCount !== 0) {
    throw new Error("Platform setup created an unexpected event.");
  }

  return {
    operatorUserId: operator.id,
    workspaceId: workspace.id,
  };
}

export async function getPlatformBootstrapStateFromStore(
  store: Pick<PlatformSetupStore, "getBootstrapCounts">,
): Promise<PlatformBootstrapState> {
  return resolvePlatformBootstrapStateFromCounts(
    await store.getBootstrapCounts(),
  );
}

export function resolvePlatformBootstrapStateFromCounts(
  counts: PlatformBootstrapCounts,
): PlatformBootstrapState {
  if (
    counts.platformMembers === 0 &&
    counts.activePlatformOwners === 0 &&
    counts.operatorUsers === 0 &&
    counts.events === 0 &&
    counts.workspaces === 0 &&
    counts.workspaceMembers === 0
  ) {
    return {
      state: "uninitialized",
      counts,
    };
  }

  if (
    counts.platformMembers === 0 &&
    counts.activePlatformOwners === 0 &&
    counts.operatorUsers === 0 &&
    counts.events === 0 &&
    counts.workspaces === 1 &&
    counts.workspaceMembers === 0 &&
    counts.legacyWorkspaceId !== null
  ) {
    return {
      state: "uninitialized",
      counts,
    };
  }

  if (
    counts.activePlatformOwners === 1 &&
    counts.completeOwnerLinks >= 1 &&
    counts.workspaces >= 1
  ) {
    return {
      state: "initialized",
      counts,
    };
  }

  return {
    state: "inconsistent",
    counts,
  };
}

export function verifySetupTokenHash(
  setupToken: string,
  expectedHashValue: string | undefined,
) {
  const expectedHash = parseExpectedSetupTokenHash(expectedHashValue);

  if (!expectedHash) {
    return false;
  }

  const actualHash = createHash("sha256").update(setupToken).digest();

  return (
    actualHash.length === expectedHash.length &&
    timingSafeEqual(actualHash, expectedHash)
  );
}

function parseExpectedSetupTokenHash(value: string | undefined) {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  if (/^[a-f0-9]{64}$/i.test(normalized)) {
    return Buffer.from(normalized, "hex");
  }

  try {
    const decoded = Buffer.from(normalized, "base64url");

    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}
