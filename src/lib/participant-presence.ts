export const PARTICIPANT_HEARTBEAT_MS = 15_000;
export const PARTICIPANT_PRESENCE_TTL_MS = 40_000;

export type ParticipantPresenceInput = {
  connectionId: string;
  action: "connect" | "heartbeat" | "disconnect";
};

export function isParticipantPresenceInput(value: unknown): value is ParticipantPresenceInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 2 &&
    typeof record.connectionId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.connectionId) &&
    (record.action === "connect" || record.action === "heartbeat" || record.action === "disconnect");
}
