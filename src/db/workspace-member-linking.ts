import { DEFAULT_WORKSPACE_HANDLE } from "../lib/workspace.ts";
import { workspaceMemberRoleValues } from "./schema.ts";

export const DEFAULT_WORKSPACE_MEMBER_ROLE = "owner";

export type WorkspaceMemberLinkOptions = {
  workspaceHandle: string;
  role: (typeof workspaceMemberRoleValues)[number];
};

const WORKSPACE_HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export function resolveWorkspaceMemberLinkOptions(
  env: Partial<
    Pick<NodeJS.ProcessEnv, "WORKSPACE_HANDLE" | "WORKSPACE_MEMBER_ROLE">
  >,
): WorkspaceMemberLinkOptions {
  const workspaceHandle =
    env.WORKSPACE_HANDLE?.trim() || DEFAULT_WORKSPACE_HANDLE;
  const role = env.WORKSPACE_MEMBER_ROLE?.trim() || DEFAULT_WORKSPACE_MEMBER_ROLE;

  if (!WORKSPACE_HANDLE_PATTERN.test(workspaceHandle)) {
    throw new Error(
      "WORKSPACE_HANDLE must match the workspace handle format.",
    );
  }

  if (!isWorkspaceMemberRole(role)) {
    throw new Error(
      `WORKSPACE_MEMBER_ROLE must be one of: ${workspaceMemberRoleValues.join(
        ", ",
      )}.`,
    );
  }

  return {
    workspaceHandle,
    role,
  };
}

export function isWorkspaceMemberRole(
  value: string,
): value is WorkspaceMemberLinkOptions["role"] {
  return workspaceMemberRoleValues.includes(
    value as WorkspaceMemberLinkOptions["role"],
  );
}

export function formatWorkspaceMemberLinkSummary(input: {
  workspaceHandle: string;
  workspaceExists: boolean;
  operatorExists: boolean;
  membershipStatus: "created" | "updated" | "already_exists";
  role: string;
}) {
  return [
    "Workspace member link result",
    `- workspace handle: ${input.workspaceHandle}`,
    `- workspace exists: ${formatYesNo(input.workspaceExists)}`,
    `- operator exists: ${formatYesNo(input.operatorExists)}`,
    `- membership: ${input.membershipStatus}`,
    `- role: ${input.role}`,
  ].join("\n");
}

function formatYesNo(value: boolean) {
  return value ? "yes" : "no";
}
