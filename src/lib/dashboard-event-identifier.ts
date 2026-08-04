import { isEventPublicId } from "./event-session-identity.ts";

export type DashboardEventIdentifier = { kind: "public"; value: string };

export function parseDashboardEventIdentifier(
  value: string,
): DashboardEventIdentifier | null {
  if (isEventPublicId(value)) {
    return { kind: "public", value: value.toLowerCase() };
  }

  return null;
}
