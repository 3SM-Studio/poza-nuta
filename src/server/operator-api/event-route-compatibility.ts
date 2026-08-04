import "server-only";

import { and, eq } from "drizzle-orm";

import { events } from "../../db/schema";
import { isEventPublicId } from "../../lib/event-session-identity";
import { getDb } from "../db";
import { getDashboardOrganizationForAuthUser } from "./organizations";

export type DashboardEventRouteResolution =
  | { kind: "canonical"; eventPublicId: string }
  | {
      kind: "legacy_redirect";
      organizationPublicId: string;
      event: { publicId: string; name: string };
    }
  | { kind: "not_found" };

export async function resolveDashboardEventRouteForAuthUser(input: {
  authUserId: string;
  organizationId: string;
  routeEventId: string;
}): Promise<DashboardEventRouteResolution> {
  if (isEventPublicId(input.routeEventId)) {
    return {
      kind: "canonical",
      eventPublicId: input.routeEventId.toLowerCase(),
    };
  }

  const numericEventId = parseLegacyNumericEventId(input.routeEventId);
  if (numericEventId === null) {
    return { kind: "not_found" };
  }

  const organization = await getDashboardOrganizationForAuthUser(
    input.authUserId,
    input.organizationId,
  );
  if (!organization) {
    return { kind: "not_found" };
  }

  const [event] = await getDb()
    .select({ publicId: events.publicId, name: events.name })
    .from(events)
    .where(
      and(
        eq(events.workspaceId, organization.id),
        eq(events.id, numericEventId),
      ),
    )
    .limit(1);

  if (!event) {
    return { kind: "not_found" };
  }

  return {
    kind: "legacy_redirect",
    organizationPublicId: organization.publicId,
    event,
  };
}

function parseLegacyNumericEventId(value: string) {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const eventId = Number(value);
  return Number.isSafeInteger(eventId) ? eventId : null;
}
