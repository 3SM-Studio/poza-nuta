import "server-only";

import { operatorAuditLog } from "../../db/schema";
import { getDb } from "../db";
import { setLocalDatabaseTimeouts } from "../database-transaction-timeouts";
import { proposeQueue } from "../fair-queue-engine";
import { anchorLegacyApprovedRequests, loadFairQueueSnapshot, writeApprovedOrder } from "./fair-queue-store";
import { loadDashboardEventQueueItems, requireEventQueueManagerContext } from "./event-queue";
import { OperatorApiError } from "./errors";

type Scope = { authUserId: string; organizationId: string; eventId: string };

export async function previewFairEventQueue(input: Scope) {
  return getDb().transaction(async transaction => {
    await setLocalDatabaseTimeouts(transaction);
    const context = await requireEventQueueManagerContext(transaction, input.authUserId, input.organizationId, input.eventId);
    const snapshot = await loadFairQueueSnapshot(transaction, context.event.id);
    const proposal = proposeQueue(snapshot.requests,snapshot.engine);
    const items = await loadDashboardEventQueueItems(transaction, context.event.id);
    const approved = new Map(items.filter(row => row.status === "approved").map(row => [row.id, row]));
    return {
      revision: snapshot.revision, engine:snapshot.engine,
      changes: proposal.order.map((id, index) => ({
        id, from: approved.get(id)!.position, to: index + 1,
        displayName: approved.get(id)!.displayName,
        songTitle: approved.get(id)!.song.title,
        decision:proposal.decisions?.get(id),
      })),
    };
  });
}

export async function applyFairEventQueue(input: Scope & { revision: string }) {
  if (!/^[a-f0-9]{64}$/.test(input.revision)) throw new OperatorApiError(400, "VALIDATION_ERROR", "Invalid queue revision.");
  return getDb().transaction(async transaction => {
    await setLocalDatabaseTimeouts(transaction);
    const context = await requireEventQueueManagerContext(transaction, input.authUserId, input.organizationId, input.eventId);
    const snapshot = await loadFairQueueSnapshot(transaction, context.event.id);
    if (snapshot.revision !== input.revision) {
      throw new OperatorApiError(409, "FAIR_QUEUE_PREVIEW_STALE", "The queue changed. Prepare a new preview.");
    }
    const { order } = proposeQueue(snapshot.requests,snapshot.engine);
    const changedAt = new Date();
    const changed = await writeApprovedOrder(transaction, context.event.id, snapshot.requests, order, changedAt);
    await anchorLegacyApprovedRequests(transaction, context.event.id, snapshot.requests, changedAt, context.organization.operatorId);
    const before = snapshot.requests.filter(row => row.status === "approved")
      .sort((a, b) => a.position - b.position || a.id - b.id).map(row => row.id);
    await transaction.insert(operatorAuditLog).values({
      actorKind: "operator", operatorId: context.organization.operatorId, eventId: context.event.id,
      action: "event_queue_fair_sort", entityId: String(context.event.id), createdAt: changedAt,
      payload: { engine:snapshot.engine, before, after: order, outcome: changed ? "changed" : "unchanged", changed },
    });
    return { changed, items: await loadDashboardEventQueueItems(transaction, context.event.id) };
  });
}
