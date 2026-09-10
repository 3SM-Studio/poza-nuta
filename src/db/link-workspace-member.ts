import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { requireAdminDatabaseUrl } from "./admin-database-url.ts";
import { logDatabaseError } from "./log-db-error.ts";
import { operatorUsers, workspaceMembers, workspaces } from "./schema.ts";
import {
  formatWorkspaceMemberLinkSummary,
  resolveWorkspaceMemberLinkOptions,
} from "./workspace-member-linking.ts";

config({ path: [".env.local", ".env"], quiet: true });

async function linkWorkspaceMember() {
  const databaseUrl = requireAdminDatabaseUrl();
  const authUserId = process.env.OPERATOR_AUTH_USER_ID?.trim();
  const options = resolveWorkspaceMemberLinkOptions({
    WORKSPACE_HANDLE: process.env.WORKSPACE_HANDLE,
    WORKSPACE_MEMBER_ROLE: process.env.WORKSPACE_MEMBER_ROLE,
  });

  if (!authUserId) {
    throw new Error("OPERATOR_AUTH_USER_ID is not configured.");
  }

  const client = postgres(databaseUrl, {
    connect_timeout: 5,
    idle_timeout: 20,
    max: 1,
    prepare: false,
  });
  const db = drizzle({ client });

  try {
    const result = await db.transaction(async (transaction) => {
      const [workspace] = await transaction
        .select({
          id: workspaces.id,
          active: workspaces.active,
        })
        .from(workspaces)
        .where(eq(workspaces.handle, options.workspaceHandle))
        .limit(1);

      if (!workspace) {
        throw new Error("Workspace was not found for WORKSPACE_HANDLE.");
      }

      if (!workspace.active) {
        throw new Error("Workspace for WORKSPACE_HANDLE is inactive.");
      }

      const [operator] = await transaction
        .select({
          id: operatorUsers.id,
          active: operatorUsers.active,
        })
        .from(operatorUsers)
        .where(eq(operatorUsers.authUserId, authUserId))
        .limit(1);

      if (!operator) {
        throw new Error("Operator user was not found for OPERATOR_AUTH_USER_ID.");
      }

      if (!operator.active) {
        throw new Error("Operator user for OPERATOR_AUTH_USER_ID is inactive.");
      }

      const [existingMembership] = await transaction
        .select({
          id: workspaceMembers.id,
          role: workspaceMembers.role,
          active: workspaceMembers.active,
        })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspace.id),
            eq(workspaceMembers.operatorUserId, operator.id),
          ),
        )
        .limit(1);

      if (existingMembership) {
        if (!existingMembership.active) {
          const [updatedMembership] = await transaction
            .update(workspaceMembers)
            .set({
              active: true,
              updatedAt: new Date(),
            })
            .where(eq(workspaceMembers.id, existingMembership.id))
            .returning({
              role: workspaceMembers.role,
            });

          return {
            membershipStatus: "updated" as const,
            role: updatedMembership?.role ?? existingMembership.role,
          };
        }

        return {
          membershipStatus: "already_exists" as const,
          role: existingMembership.role,
        };
      }

      const [createdMembership] = await transaction
        .insert(workspaceMembers)
        .values({
          workspaceId: workspace.id,
          operatorUserId: operator.id,
          role: options.role,
          active: true,
        })
        .returning({
          role: workspaceMembers.role,
        });

      if (!createdMembership) {
        throw new Error("Workspace membership could not be created.");
      }

      return {
        membershipStatus: "created" as const,
        role: createdMembership.role,
      };
    });

    console.log(
      formatWorkspaceMemberLinkSummary({
        workspaceHandle: options.workspaceHandle,
        workspaceExists: true,
        operatorExists: true,
        membershipStatus: result.membershipStatus,
        role: result.role,
      }),
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

linkWorkspaceMember().catch((error: unknown) => {
  logDatabaseError("Workspace member linking failed", error);
  process.exitCode = 1;
});
