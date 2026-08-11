import { and, isNull, lte, ne, sql } from "drizzle-orm";

import { events } from "./schema.ts";

export function getEffectivelyActiveEventCondition(now: Date) {
  const nowIso = now.toISOString();

  return and(
    ne(events.status, "closed"),
    ne(events.status, "cancelled"),
    isNull(events.closedAt),
    lte(events.startsAt, now),
    sql`coalesce(${events.autoCloseAt}, ${events.endsAt}) > ${nowIso}::timestamptz`,
  );
}
