import {
  createPlatformAuditRecord,
  type PlatformAuditEvent,
  type PlatformAuditRecord,
} from "./audit-core";

type VerifiedPlatformActor = {
  operator: {
    id: number;
    active: true;
  };
};

export type PlatformAuditDependencies = {
  requireVerifiedActor: () => Promise<VerifiedPlatformActor>;
  insertAuditRecord: (record: PlatformAuditRecord) => Promise<void>;
};

export async function persistPlatformAuditEvent(
  event: PlatformAuditEvent,
  dependencies: PlatformAuditDependencies,
): Promise<void> {
  const actor = await dependencies.requireVerifiedActor();
  const record = createPlatformAuditRecord(actor.operator.id, event);

  await dependencies.insertAuditRecord(record);
}
