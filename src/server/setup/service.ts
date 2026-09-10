import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import {
  events,
  operatorUsers,
  platformMembers,
  workspaceMembers,
  workspaces,
} from "../../db/schema.ts";
import { generateOrganizationPublicId } from "../../lib/organization-public-id.ts";
import {
  DEFAULT_WORKSPACE_HANDLE,
  DEFAULT_WORKSPACE_NAME,
} from "../../lib/workspace.ts";
import { getDb } from "../db.ts";
import {
  completePlatformSetupWithStore,
  getPlatformBootstrapStateFromStore,
  type PlatformBootstrapCounts,
  type PlatformSetupStore,
  type VerifiedSetupUser,
} from "./core.ts";
import type { PlatformSetupInput } from "./validation.ts";

export {
  completePlatformSetupWithStore,
  getPlatformBootstrapStateFromStore,
  resolvePlatformBootstrapStateFromCounts,
  verifySetupTokenHash,
  type CompletePlatformSetupDependencies,
  type CompletePlatformSetupResult,
  type PlatformBootstrapCounts,
  type PlatformBootstrapState,
  type PlatformSetupStore,
  type VerifiedSetupUser,
} from "./core.ts";

const SETUP_LOCK_KEY = "poza_nuta_platform_initial_setup";
const SUPABASE_AUTH_PASSWORD_HASH_PLACEHOLDER = "supabase-auth-managed";

export async function getPlatformBootstrapState() {
  return getPlatformBootstrapStateFromStore(createDrizzleSetupReadStore());
}

export async function completePlatformSetup(input: {
  data: PlatformSetupInput;
  getVerifiedUser: () => Promise<VerifiedSetupUser>;
}) {
  return getDb().transaction(async (transaction) =>
    completePlatformSetupWithStore(input.data, {
      store: createDrizzleSetupTransactionStore(transaction),
      getVerifiedUser: input.getVerifiedUser,
      setupTokenHash: process.env.PLATFORM_SETUP_TOKEN_SHA256,
    }),
  );
}

type DatabaseTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

function createDrizzleSetupReadStore(): Pick<
  PlatformSetupStore,
  "getBootstrapCounts"
> {
  const db = getDb();

  return {
    getBootstrapCounts: () => getBootstrapCounts(db),
  };
}

function createDrizzleSetupTransactionStore(
  transaction: DatabaseTransaction,
): PlatformSetupStore {
  return {
    acquireSetupLock: async () => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${SETUP_LOCK_KEY}))`,
      );
    },
    getBootstrapCounts: () => getBootstrapCounts(transaction),
    createOperator: async (input) => {
      const [operator] = await transaction
        .insert(operatorUsers)
        .values({
          name: input.displayName,
          displayName: input.displayName,
          profileCompletedAt: input.now,
          authUserId: input.authUserId,
          passwordHash: SUPABASE_AUTH_PASSWORD_HASH_PLACEHOLDER,
          active: true,
          suspendedAt: null,
          suspensionReason: null,
          suspendedByOperatorId: null,
          updatedAt: input.now,
        })
        .returning({ id: operatorUsers.id });

      if (!operator) {
        throw new Error("Operator could not be created.");
      }

      return operator;
    },
    createPlatformOwner: async (input) => {
      await transaction.insert(platformMembers).values({
        operatorUserId: input.operatorUserId,
        role: "platform_owner",
        active: true,
        updatedAt: input.now,
      });
    },
    createWorkspace: async (input) => {
      if (input.legacyWorkspaceId !== null) {
        const [workspace] = await transaction
          .update(workspaces)
          .set({
            name: input.name,
            handle: input.handle,
            active: true,
            updatedAt: input.now,
          })
          .where(eq(workspaces.id, input.legacyWorkspaceId))
          .returning({ id: workspaces.id });

        if (!workspace) {
          throw new Error("Workspace could not be updated.");
        }

        return workspace;
      }

      const [workspace] = await transaction
        .insert(workspaces)
        .values({
          publicId: generateOrganizationPublicId(),
          name: input.name,
          handle: input.handle,
          active: true,
          updatedAt: input.now,
        })
        .returning({ id: workspaces.id });

      if (!workspace) {
        throw new Error("Workspace could not be created.");
      }

      return workspace;
    },
    createWorkspaceOwner: async (input) => {
      await transaction.insert(workspaceMembers).values({
        workspaceId: input.workspaceId,
        operatorUserId: input.operatorUserId,
        role: "owner",
        active: true,
        updatedAt: input.now,
      });
    },
    countEvents: async () => {
      const [row] = await transaction
        .select({ count: sql<number>`count(*)::int` })
        .from(events);

      return row?.count ?? 0;
    },
  };
}

async function getBootstrapCounts(
  db: Pick<ReturnType<typeof getDb>, "select">,
): Promise<PlatformBootstrapCounts> {
  const [
    platformMembersCount,
    activePlatformOwnersCount,
    operatorUsersCount,
    workspacesCount,
    workspaceMembersCount,
    completeOwnerLinksCount,
    eventsCount,
    legacyWorkspaceId,
  ] = await Promise.all([
    countRows(db, platformMembers),
    countRows(
      db,
      platformMembers,
      and(
        eq(platformMembers.role, "platform_owner"),
        eq(platformMembers.active, true),
      ),
    ),
    countRows(db, operatorUsers),
    countRows(db, workspaces),
    countRows(db, workspaceMembers),
    countCompleteOwnerLinks(db),
    countRows(db, events),
    getLegacyWorkspaceId(db),
  ]);

  return {
    platformMembers: platformMembersCount,
    activePlatformOwners: activePlatformOwnersCount,
    operatorUsers: operatorUsersCount,
    workspaces: workspacesCount,
    workspaceMembers: workspaceMembersCount,
    completeOwnerLinks: completeOwnerLinksCount,
    events: eventsCount,
    legacyWorkspaceId,
  };
}

async function countRows(
  db: Pick<ReturnType<typeof getDb>, "select">,
  table:
    | typeof events
    | typeof platformMembers
    | typeof operatorUsers
    | typeof workspaces
    | typeof workspaceMembers,
  where?: unknown,
) {
  const query = db.select({ count: sql<number>`count(*)::int` }).from(table);
  const [row] = where ? await query.where(where as never) : await query;

  return row?.count ?? 0;
}

async function countCompleteOwnerLinks(
  db: Pick<ReturnType<typeof getDb>, "select">,
) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(platformMembers)
    .innerJoin(
      operatorUsers,
      eq(operatorUsers.id, platformMembers.operatorUserId),
    )
    .innerJoin(
      workspaceMembers,
      eq(workspaceMembers.operatorUserId, operatorUsers.id),
    )
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(platformMembers.role, "platform_owner"),
        eq(platformMembers.active, true),
        eq(operatorUsers.active, true),
        isNull(operatorUsers.suspendedAt),
        sql`${operatorUsers.authUserId} is not null`,
        eq(workspaceMembers.active, true),
        eq(workspaceMembers.role, "owner"),
        eq(workspaces.active, true),
      ),
    );

  return row?.count ?? 0;
}

async function getLegacyWorkspaceId(db: Pick<ReturnType<typeof getDb>, "select">) {
  const rows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.name, DEFAULT_WORKSPACE_NAME),
        eq(workspaces.handle, DEFAULT_WORKSPACE_HANDLE),
      ),
    );

  return rows.length === 1 ? rows[0]?.id ?? null : null;
}
