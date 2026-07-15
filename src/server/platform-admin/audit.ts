import "server-only";

import { operatorAuditLog } from "@/db/schema";

import { getDb } from "../db";
import { requirePlatformAdminAccess } from "./guard";
import {
  persistPlatformAuditEvent,
  type PlatformAuditDependencies,
} from "./audit-service";
import type { PlatformAuditEvent } from "./audit-core";
import type { PlatformPermission } from "./policy";

export async function writePlatformAuditEvent(
  permission: PlatformPermission,
  event: PlatformAuditEvent,
): Promise<void> {
  await persistPlatformAuditEvent(event, {
    requireVerifiedActor: () => requirePlatformAdminAccess(permission),
    insertAuditRecord,
  });
}

const insertAuditRecord: PlatformAuditDependencies["insertAuditRecord"] =
  async (record) => {
    await getDb().insert(operatorAuditLog).values(record);
  };
