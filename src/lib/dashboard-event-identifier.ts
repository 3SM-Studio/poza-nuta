import { isEventPublicId } from "./event-session-identity.ts";

export type DashboardEventIdentifier =
  | { kind: "public"; value: string }
  | { kind: "legacy"; value: number };

export function parseDashboardEventIdentifier(
  value: string | number,
): DashboardEventIdentifier | null {
  if (typeof value === "string" && isEventPublicId(value)) {
    return { kind: "public", value: value.toLowerCase() };
  }

  const legacyValue = typeof value === "number" ? value : Number(value);
  if (
    (typeof value === "number" || /^[1-9]\d*$/.test(value)) &&
    Number.isSafeInteger(legacyValue) &&
    legacyValue > 0
  ) {
    return { kind: "legacy", value: legacyValue };
  }

  return null;
}
