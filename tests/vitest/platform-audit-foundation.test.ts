import { describe, expect, it, vi } from "vitest";

import {
  createPlatformAuditRecord,
  PlatformAuditValidationError,
  type PlatformAuditEvent,
} from "@/server/platform-admin/audit-core";
import { persistPlatformAuditEvent } from "@/server/platform-admin/audit-service";

const validEvent = {
  action: "user.suspend",
  targetType: "operator_user",
  targetId: "42",
  outcome: "success",
  summary: "Application access suspended.",
  reason: "Repeated abuse of event access.",
  metadata: {
    source: "platform_admin",
    retainedMemberships: true,
  },
} as const satisfies PlatformAuditEvent;

describe("platform audit record contract", () => {
  it("maps the platform contract onto the existing audit table shape", () => {
    expect(createPlatformAuditRecord(7, validEvent)).toEqual({
      operatorId: 7,
      action: "user.suspend",
      entityId: "42",
      payload: {
        schemaVersion: 1,
        targetType: "operator_user",
        outcome: "success",
        summary: "Application access suspended.",
        reason: "Repeated abuse of event access.",
        metadata: {
          source: "platform_admin",
          retainedMemberships: true,
        },
      },
    });
  });

  it("does not require fields absent from existing audit rows", () => {
    const existingRow = {
      operatorId: 7,
      action: "login",
      entityId: "auth-user-id",
      payload: {},
    };

    expect(existingRow).not.toHaveProperty("payload.schemaVersion");
    expect(existingRow).not.toHaveProperty("payload.targetType");
    expect(existingRow).not.toHaveProperty("payload.outcome");
  });

  it.each([
    ["access token", { accessToken: "sensitive" }],
    ["cookie", { request: { cookies: "sensitive" } }],
    ["password", { passwordHash: "sensitive" }],
    ["service role", { service_role: "sensitive" }],
    ["complete Auth user", { authUser: { id: "auth-id" } }],
    ["identity collection", { identities: [] }],
    ["actor override", { actorId: 99 }],
    ["role override", { role: "platform_owner" }],
    ["raw error key", { error: "database details" }],
  ])("rejects %s metadata", (_label, metadata) => {
    expect(() => createPlatformAuditRecord(7, { ...validEvent, metadata })).toThrow(
      PlatformAuditValidationError,
    );
  });

  it("rejects Error instances instead of serializing raw errors", () => {
    expect(() =>
      createPlatformAuditRecord(7, {
        ...validEvent,
        metadata: { diagnostic: new Error("database details") },
      }),
    ).toThrow("Raw errors are not permitted.");
  });

  it.each([
    "Bearer opaque-token-value",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
    "Cookie: participant_session=opaque",
    "operator@example.test",
  ])("rejects recognizable sensitive text: %s", (summary) => {
    expect(() =>
      createPlatformAuditRecord(7, { ...validEvent, summary }),
    ).toThrow("contains sensitive data");
  });

  it("rejects invalid semantic values at runtime", () => {
    expect(() =>
      createPlatformAuditRecord(7, {
        ...validEvent,
        action: "arbitrary.action",
      } as unknown as PlatformAuditEvent),
    ).toThrow("Audit action is invalid.");
  });

  it("copies metadata so later input mutation cannot alter the record", () => {
    const metadata = { counters: { changed: 1 } };
    const record = createPlatformAuditRecord(7, { ...validEvent, metadata });

    metadata.counters.changed = 2;

    expect(record.payload.metadata).toEqual({ counters: { changed: 1 } });
  });
});

describe("platform audit writer", () => {
  it("derives the actor from verified server context", async () => {
    const insertAuditRecord = vi.fn(async () => undefined);

    await persistPlatformAuditEvent(
      { ...validEvent, actorId: 999, role: "platform_owner" } as PlatformAuditEvent,
      {
        requireVerifiedActor: async () => ({
          operator: { id: 7, active: true },
        }),
        insertAuditRecord,
      },
    );

    expect(insertAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ operatorId: 7 }),
    );
  });

  it("does not write when actor verification fails", async () => {
    const insertAuditRecord = vi.fn(async () => undefined);

    await expect(
      persistPlatformAuditEvent(validEvent, {
        requireVerifiedActor: async () => {
          throw new Error("unauthorized");
        },
        insertAuditRecord,
      }),
    ).rejects.toThrow("unauthorized");
    expect(insertAuditRecord).not.toHaveBeenCalled();
  });

  it("fails closed when the required audit insert fails", async () => {
    await expect(
      persistPlatformAuditEvent(validEvent, {
        requireVerifiedActor: async () => ({
          operator: { id: 7, active: true },
        }),
        insertAuditRecord: async () => {
          throw new Error("audit unavailable");
        },
      }),
    ).rejects.toThrow("audit unavailable");
  });
});
