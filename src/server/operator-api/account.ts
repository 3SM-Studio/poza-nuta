type AuthIdentityLike = Record<string, unknown>;

export type SafeAuthIdentity = {
  provider: string;
  id: string | null;
  identityId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastSignInAt: string | null;
};

export function sanitizeAuthIdentities(input: unknown): SafeAuthIdentity[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((identity) => {
    const record = isRecord(identity) ? identity : {};

    return {
      provider: getStringField(record, "provider") ?? "unknown",
      id: getStringField(record, "id"),
      identityId: getStringField(record, "identity_id"),
      createdAt: getStringField(record, "created_at"),
      updatedAt: getStringField(record, "updated_at"),
      lastSignInAt: getStringField(record, "last_sign_in_at"),
    };
  });
}

function isRecord(input: unknown): input is AuthIdentityLike {
  return typeof input === "object" && input !== null;
}

function getStringField(record: AuthIdentityLike, field: string) {
  const value = record[field];

  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
