import { DEFAULT_WORKSPACE_HANDLE } from "./workspace.ts";

export const ORGANIZATION_NAME_MAX_LENGTH = 160;

export function normalizeOrganizationName(input: string) {
  return input.trim().replace(/\s+/g, " ");
}

export function buildWorkspaceHandleFromName(input: string) {
  const normalized = normalizeOrganizationName(input)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return normalized || DEFAULT_WORKSPACE_HANDLE;
}

export function validateOrganizationName(input: string) {
  const name = normalizeOrganizationName(input);

  if (name.length === 0) {
    return {
      success: false as const,
      message: "Podaj nazwę organizacji.",
    };
  }

  if (name.length > ORGANIZATION_NAME_MAX_LENGTH) {
    return {
      success: false as const,
      message: `Nazwa organizacji może mieć maksymalnie ${ORGANIZATION_NAME_MAX_LENGTH} znaków.`,
    };
  }

  return {
    success: true as const,
    name,
  };
}

export function buildOwnerWorkspaceMembershipInput(input: {
  workspaceId: number;
  operatorUserId: number;
}) {
  return {
    workspaceId: input.workspaceId,
    operatorUserId: input.operatorUserId,
    role: "owner" as const,
    active: true,
  };
}
