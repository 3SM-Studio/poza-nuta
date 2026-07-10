import {
  MAX_OPERATOR_PROFILE_DISPLAY_NAME_LENGTH,
  MIN_OPERATOR_PROFILE_DISPLAY_NAME_LENGTH,
  type ValidationIssue,
  type ValidationResult,
} from "../operator-api/validation.ts";
import {
  ORGANIZATION_NAME_MAX_LENGTH,
  normalizeOrganizationName,
} from "../../lib/organization-workspace.ts";

export const MIN_SETUP_TOKEN_LENGTH = 32;
export const MAX_SETUP_TOKEN_LENGTH = 200;
export const MIN_WORKSPACE_HANDLE_LENGTH = 3;
export const MAX_WORKSPACE_HANDLE_LENGTH = 80;

export type PlatformSetupInput = {
  setupToken: string;
  displayName: string;
  workspaceName: string;
  workspaceHandle: string;
};

export type PlatformSetupInviteInput = {
  setupToken: string;
  email: string;
};

export function validatePlatformSetupInviteInput(
  input: unknown,
): ValidationResult<PlatformSetupInviteInput> {
  if (!isRecord(input)) {
    return {
      success: false,
      issues: [{ field: "body", message: "Body must be a JSON object." }],
    };
  }

  const issues: ValidationIssue[] = [];
  const setupToken =
    typeof input.setupToken === "string" ? input.setupToken.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";

  if (typeof input.setupToken !== "string" || setupToken.length === 0) {
    issues.push({ field: "setupToken", message: "setupToken is required." });
  } else if (
    setupToken.length < MIN_SETUP_TOKEN_LENGTH ||
    setupToken.length > MAX_SETUP_TOKEN_LENGTH
  ) {
    issues.push({ field: "setupToken", message: "setupToken is invalid." });
  }

  if (typeof input.email !== "string" || email.length === 0) {
    issues.push({ field: "email", message: "email is required." });
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    issues.push({ field: "email", message: "email is invalid." });
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return {
    success: true,
    data: {
      setupToken,
      email,
    },
  };
}

export function validatePlatformSetupInput(
  input: unknown,
): ValidationResult<PlatformSetupInput> {
  if (!isRecord(input)) {
    return {
      success: false,
      issues: [{ field: "body", message: "Body must be a JSON object." }],
    };
  }

  const issues: ValidationIssue[] = [];
  const setupToken =
    typeof input.setupToken === "string" ? input.setupToken.trim() : "";
  const displayName =
    typeof input.displayName === "string" ? input.displayName.trim() : "";
  const workspaceName =
    typeof input.workspaceName === "string"
      ? normalizeOrganizationName(input.workspaceName)
      : "";
  const workspaceHandle =
    typeof input.workspaceHandle === "string"
      ? input.workspaceHandle.trim().toLowerCase()
      : "";

  if (typeof input.setupToken !== "string" || setupToken.length === 0) {
    issues.push({ field: "setupToken", message: "setupToken is required." });
  } else if (
    setupToken.length < MIN_SETUP_TOKEN_LENGTH ||
    setupToken.length > MAX_SETUP_TOKEN_LENGTH
  ) {
    issues.push({ field: "setupToken", message: "setupToken is invalid." });
  }

  if (typeof input.displayName !== "string" || displayName.length === 0) {
    issues.push({ field: "displayName", message: "displayName is required." });
  } else if (
    displayName.length < MIN_OPERATOR_PROFILE_DISPLAY_NAME_LENGTH ||
    displayName.length > MAX_OPERATOR_PROFILE_DISPLAY_NAME_LENGTH
  ) {
    issues.push({ field: "displayName", message: "displayName is invalid." });
  }

  if (typeof input.workspaceName !== "string" || workspaceName.length === 0) {
    issues.push({
      field: "workspaceName",
      message: "workspaceName is required.",
    });
  } else if (workspaceName.length > ORGANIZATION_NAME_MAX_LENGTH) {
    issues.push({
      field: "workspaceName",
      message: "workspaceName is invalid.",
    });
  }

  if (typeof input.workspaceHandle !== "string" || workspaceHandle.length === 0) {
    issues.push({
      field: "workspaceHandle",
      message: "workspaceHandle is required.",
    });
  } else if (
    workspaceHandle.length < MIN_WORKSPACE_HANDLE_LENGTH ||
    workspaceHandle.length > MAX_WORKSPACE_HANDLE_LENGTH ||
    !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(workspaceHandle)
  ) {
    issues.push({
      field: "workspaceHandle",
      message: "workspaceHandle is invalid.",
    });
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return {
    success: true,
    data: {
      setupToken,
      displayName,
      workspaceName,
      workspaceHandle,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
