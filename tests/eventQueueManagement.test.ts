import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canApplyDashboardEventQueueAction,
  canManageDashboardEventQueue,
  canReorderDashboardEventQueueRequest,
  getDashboardEventQueueFilterStatuses,
  getDashboardEventQueueTargetStatus,
} from "../src/lib/dashboard-event-queue.ts";
import {
  applyOptimisticDashboardEventQueueAction,
  getDashboardEventQueueActionOperationKey,
  isDashboardEventQueueRequestPending,
  reconcileDashboardEventQueueItem,
  restoreDashboardEventQueueItems,
  type DashboardEventQueueOptimisticItem,
} from "../src/lib/dashboard-event-queue-optimistic.ts";
import { PUBLIC_QUEUE_VISIBLE_STATUSES } from "../src/server/public-api/queue-policy.ts";
import {
  validateDashboardEventQueueActionInput,
  validateDashboardEventQueueFilter,
  validateDashboardEventQueueMoveInput,
} from "../src/server/operator-api/event-queue-validation.ts";

test("event queue uses the existing request statuses and ordering fields", () => {
  const schemaSource = readFileSync(
    new URL("../src/db/schema.ts", import.meta.url),
    "utf8",
  );
  const requestTableStart = schemaSource.indexOf(
    "export const songRequests = pgTable",
  );
  const operatorSessionsStart = schemaSource.indexOf(
    "export const operatorSessions = pgTable",
  );
  const requestTableSource = schemaSource.slice(
    requestTableStart,
    operatorSessionsStart,
  );

  assert.match(
    schemaSource,
    /requestStatusValues = \[\s*"pending",\s*"approved",\s*"now",\s*"done",\s*"skipped",\s*"rejected",/s,
  );
  assert.match(requestTableSource, /position: integer\("position"\)\.notNull\(\)/);
  assert.match(requestTableSource, /version: integer\("version"\)/);
  assert.match(requestTableSource, /song_requests_event_queue_idx/);
});

test("public queues expose approved and current requests only", () => {
  assert.deepEqual(PUBLIC_QUEUE_VISIBLE_STATUSES, ["approved", "now"]);
});

test("owner, manager and operator can manage event queues, viewer cannot", () => {
  assert.equal(canManageDashboardEventQueue("owner"), true);
  assert.equal(canManageDashboardEventQueue("manager"), true);
  assert.equal(canManageDashboardEventQueue("operator"), true);
  assert.equal(canManageDashboardEventQueue("viewer"), false);
});

test("event queue actions preserve the existing request status model", () => {
  assert.equal(canApplyDashboardEventQueueAction("approve", "pending"), true);
  assert.equal(canApplyDashboardEventQueueAction("start", "pending"), true);
  assert.equal(canApplyDashboardEventQueueAction("start", "approved"), true);
  assert.equal(canApplyDashboardEventQueueAction("reject", "pending"), true);
  assert.equal(canApplyDashboardEventQueueAction("reject", "approved"), true);
  assert.equal(canApplyDashboardEventQueueAction("done", "approved"), true);
  assert.equal(canApplyDashboardEventQueueAction("done", "now"), true);
  assert.equal(canApplyDashboardEventQueueAction("restore", "done"), true);
  assert.equal(canApplyDashboardEventQueueAction("restore", "skipped"), true);
  assert.equal(canApplyDashboardEventQueueAction("restore", "rejected"), true);
  assert.equal(canApplyDashboardEventQueueAction("approve", "done"), false);
  assert.equal(canApplyDashboardEventQueueAction("start", "done"), false);
  assert.equal(getDashboardEventQueueTargetStatus("approve"), "approved");
  assert.equal(getDashboardEventQueueTargetStatus("start"), "now");
  assert.equal(getDashboardEventQueueTargetStatus("reject"), "rejected");
  assert.equal(getDashboardEventQueueTargetStatus("done"), "done");
  assert.equal(getDashboardEventQueueTargetStatus("restore"), "pending");
});

test("event queue pending keys are scoped per request and action", () => {
  const pendingOperations = new Set([
    getDashboardEventQueueActionOperationKey(10, "approve"),
  ]);

  assert.equal(
    getDashboardEventQueueActionOperationKey(10, "approve"),
    "10:approve",
  );
  assert.equal(isDashboardEventQueueRequestPending(pendingOperations, 10), true);
  assert.equal(isDashboardEventQueueRequestPending(pendingOperations, 11), false);
});

test("optimistic accept moves a pending request into the approved queue", () => {
  const items = [
    makeQueueItem({ id: 1, status: "approved", position: 1 }),
    makeQueueItem({ id: 2, status: "pending", position: 0 }),
  ];

  const nextItems = applyOptimisticDashboardEventQueueAction(
    items,
    2,
    "approve",
    "2026-07-06T18:00:00.000Z",
  );
  const acceptedRequest = nextItems.find((item) => item.id === 2);

  assert.equal(acceptedRequest?.status, "approved");
  assert.equal(acceptedRequest?.position, 2);
  assert.equal(acceptedRequest?.version, 2);
});

test("optimistic now marks the previous current request as done", () => {
  const items = [
    makeQueueItem({ id: 1, status: "now", position: 0 }),
    makeQueueItem({ id: 2, status: "approved", position: 1 }),
  ];

  const nextItems = applyOptimisticDashboardEventQueueAction(
    items,
    2,
    "start",
    "2026-07-06T18:00:00.000Z",
  );

  assert.equal(nextItems.find((item) => item.id === 2)?.status, "now");
  assert.equal(nextItems.find((item) => item.id === 1)?.status, "done");
  assert.equal(
    nextItems.filter((item) => item.status === "now").length,
    1,
  );
});

test("optimistic rollback restores changed request state after an error", () => {
  const items = [makeQueueItem({ id: 1, status: "pending", position: 0 })];
  const optimisticItems = applyOptimisticDashboardEventQueueAction(
    items,
    1,
    "reject",
    "2026-07-06T18:00:00.000Z",
  );

  const restoredItems = restoreDashboardEventQueueItems(optimisticItems, items);

  assert.equal(restoredItems[0]?.status, "pending");
  assert.equal(restoredItems[0]?.version, 1);
});

test("backend or realtime reconcile overwrites optimistic request state", () => {
  const items = [makeQueueItem({ id: 1, status: "pending", position: 0 })];
  const optimisticItems = applyOptimisticDashboardEventQueueAction(
    items,
    1,
    "approve",
    "2026-07-06T18:00:00.000Z",
  );
  const reconciledItems = reconcileDashboardEventQueueItem(
    optimisticItems,
    makeQueueItem({
      id: 1,
      status: "rejected",
      position: 0,
      version: 10,
      updatedAt: "2026-07-06T18:01:00.000Z",
    }),
  );

  assert.equal(reconciledItems[0]?.status, "rejected");
  assert.equal(reconciledItems[0]?.version, 10);
});

test("event queue filters map to existing statuses", () => {
  assert.equal(getDashboardEventQueueFilterStatuses("all"), null);
  assert.deepEqual(getDashboardEventQueueFilterStatuses("pending"), ["pending"]);
  assert.deepEqual(getDashboardEventQueueFilterStatuses("approved"), [
    "approved",
  ]);
  assert.deepEqual(getDashboardEventQueueFilterStatuses("rejected"), [
    "rejected",
  ]);
  assert.deepEqual(getDashboardEventQueueFilterStatuses("closed"), [
    "done",
    "skipped",
  ]);
  assert.equal(validateDashboardEventQueueFilter("unsupported"), "all");
});

test("event queue API validation rejects unsupported actions and moves", () => {
  assert.deepEqual(validateDashboardEventQueueActionInput({ action: "approve" }), {
    success: true,
    data: "approve",
  });
  assert.deepEqual(validateDashboardEventQueueActionInput({ action: "start" }), {
    success: true,
    data: "start",
  });
  assert.deepEqual(validateDashboardEventQueueMoveInput({ direction: "up" }), {
    success: true,
    data: "up",
  });
  assert.equal(
    validateDashboardEventQueueMoveInput({ direction: "sideways" }).success,
    false,
  );
});

test("event queue reads and writes are scoped to the resolved event", () => {
  const serviceSource = readFileSync(
    new URL("../src/server/operator-api/event-queue.ts", import.meta.url),
    "utf8",
  );
  const itemStart = serviceSource.indexOf(
    "async function requireDashboardEventQueueItem",
  );
  const renumberStart = serviceSource.indexOf(
    "async function renumberApprovedQueue",
  );
  const itemSource = serviceSource.slice(itemStart, renumberStart);

  assert.match(
    serviceSource,
    /getDashboardOrganizationEventForAuthUser\(input\)/,
  );
  assert.match(
    serviceSource,
    /\.where\(eq\(songRequests\.eventId, result\.event\.id\)\)/,
  );
  assert.match(
    serviceSource,
    /eq\(songRequests\.id, input\.requestId\),\s*eq\(songRequests\.eventId, context\.event\.id\)/s,
  );
  assert.match(
    itemSource,
    /eq\(songRequests\.id, requestId\),\s*eq\(songRequests\.eventId, eventId\)/s,
  );
  assert.match(itemSource, /404,\s*"REQUEST_NOT_FOUND"/s);
  assert.match(
    itemSource,
    /"The request does not belong to this event\."/,
  );
  assert.match(
    serviceSource,
    /eq\(events\.id, eventId\), eq\(events\.workspaceId, organization\.id\)/,
  );
});

test("event queue isolation returns safe 404 before mutating a request from another event", () => {
  const serviceSource = readFileSync(
    new URL("../src/server/operator-api/event-queue.ts", import.meta.url),
    "utf8",
  );
  const actionStart = serviceSource.indexOf(
    "export async function applyDashboardOrganizationEventQueueActionForAuthUser",
  );
  const moveStart = serviceSource.indexOf(
    "export async function moveDashboardOrganizationEventQueueRequestForAuthUser",
  );
  const actionSource = serviceSource.slice(actionStart, moveStart);
  const itemStart = serviceSource.indexOf(
    "async function requireDashboardEventQueueItem",
  );
  const renumberStart = serviceSource.indexOf(
    "async function renumberApprovedQueue",
  );
  const itemSource = serviceSource.slice(itemStart, renumberStart);

  assert.match(actionSource, /const \[queueRequest\] = await transaction/);
  assert.match(actionSource, /\.for\("update"\)/);
  assert.match(
    actionSource,
    /eq\(songRequests\.id, input\.requestId\),\s*eq\(songRequests\.eventId, context\.event\.id\)/s,
  );
  assert.match(actionSource, /if \(!queueRequest\) \{/);
  assert.match(actionSource, /404,\s*"REQUEST_NOT_FOUND"/s);
  assert.match(
    actionSource,
    /eq\(songRequests\.id, queueRequest\.id\),\s*eq\(songRequests\.eventId, context\.event\.id\)/s,
  );
  assert.match(
    itemSource,
    /eq\(songRequests\.id, requestId\),\s*eq\(songRequests\.eventId, eventId\)/s,
  );
  assert.match(itemSource, /404,\s*"REQUEST_NOT_FOUND"/s);
});

test("event queue mutations require active workspace membership", () => {
  const serviceSource = readFileSync(
    new URL("../src/server/operator-api/event-queue.ts", import.meta.url),
    "utf8",
  );
  const contextStart = serviceSource.indexOf(
    "async function requireEventQueueManagerContext",
  );
  const itemStart = serviceSource.indexOf(
    "async function requireDashboardEventQueueItem",
  );
  const contextSource = serviceSource.slice(contextStart, itemStart);

  assert.match(contextSource, /eq\(workspaces\.publicId, organizationId\)/);
  assert.match(contextSource, /eq\(operatorUsers\.authUserId, authUserId\)/);
  assert.match(contextSource, /eq\(operatorUsers\.active, true\)/);
  assert.match(contextSource, /eq\(workspaceMembers\.active, true\)/);
  assert.match(contextSource, /canManageDashboardEventQueue\(organization\.role\)/);
});

test("approved queue reorder is transactional and event-scoped", () => {
  const serviceSource = readFileSync(
    new URL("../src/server/operator-api/event-queue.ts", import.meta.url),
    "utf8",
  );
  const moveStart = serviceSource.indexOf(
    "export async function moveDashboardOrganizationEventQueueRequestForAuthUser",
  );
  const contextStart = serviceSource.indexOf(
    "async function requireEventQueueManagerContext",
  );
  const moveSource = serviceSource.slice(moveStart, contextStart);

  assert.equal(canReorderDashboardEventQueueRequest("approved"), true);
  assert.equal(canReorderDashboardEventQueueRequest("pending"), false);
  assert.match(moveSource, /\.transaction\(async \(transaction\)/);
  assert.match(moveSource, /eq\(songRequests\.status, "approved"\)/);
  assert.match(moveSource, /\.orderBy\(asc\(songRequests\.id\)\)\s*\.for\("update"\)/s);
  assert.match(moveSource, /position: request\.position/);
  assert.match(moveSource, /eq\(songRequests\.eventId, context\.event\.id\)/);
});

test("starting a request completes the previous current request in the same event", () => {
  const eventQueueSource = readFileSync(
    new URL("../src/server/operator-api/event-queue.ts", import.meta.url),
    "utf8",
  );
  const serviceSource = readFileSync(
    new URL("../src/server/operator-api/service.ts", import.meta.url),
    "utf8",
  );

  assert.match(eventQueueSource, /completeCurrentEventQueueRequests/);

  for (const source of [eventQueueSource, serviceSource]) {
    assert.match(source, /eq\(songRequests\.status, "now"\)/);
    assert.match(source, /\.orderBy\(asc\(songRequests\.id\)\)\s*\.for\("update"\)/s);
    assert.match(source, /status: "done"/);
    assert.match(source, /completedAt: changedAt/);
    assert.match(source, /startedAt: changedAt/);
    assert.match(source, /version: sql`\$\{songRequests\.version\} \+ 1`/);
  }

  assert.match(eventQueueSource, /status: targetStatus/);
  assert.match(serviceSource, /status: targetStatus/);
  assert.match(eventQueueSource, /eq\(songRequests\.eventId, context\.event\.id\)/);
  assert.match(serviceSource, /eq\(songRequests\.eventId, event\.id\)/);
});

test("public queue broadcast migration does not expose song requests to browsers", () => {
  const source = readFileSync(
    new URL(
      "../drizzle/0008_public_queue_realtime_broadcast.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const publicTopicIndex = source.indexOf("'public:event:'");
  const publicPayloadSource = source.slice(
    source.lastIndexOf("PERFORM", publicTopicIndex),
    source.indexOf(");", publicTopicIndex) + 2,
  );

  assert.match(
    source,
    /CREATE OR REPLACE FUNCTION "public"\."broadcast_song_request_queue_changed"/,
  );
  assert.match(
    source,
    /'dashboard:event:' \|\| changed_event_id::text \|\| ':queue'/,
  );
  assert.match(
    source,
    /'public:event:' \|\| changed_event_id::text \|\| ':queue'/,
  );
  assert.match(source, /FOR SELECT\s+TO "anon", "authenticated"/);
  assert.match(source, /\^public:event:\[0-9\]\+:queue\$/);
  assert.doesNotMatch(source, /ALTER\s+PUBLICATION\s+supabase_realtime/i);
  assert.doesNotMatch(
    source,
    /GRANT\s+SELECT\s+ON\s+(TABLE\s+)?"public"\."song_requests"/i,
  );
  assert.doesNotMatch(source, /FOR\s+INSERT\s+TO\s+"anon"/i);
  assert.doesNotMatch(
    publicPayloadSource,
    /eventId|song|artist|title|requester|singer|code|token|hash/i,
  );
});

test("session queue keeps privacy paths and global public queue is removed", () => {
  const sessionServiceSource = readFileSync(
    new URL("../src/server/session-api/service.ts", import.meta.url),
    "utf8",
  );
  const publicQueueRouteSource = readFileSync(
    new URL("../src/app/api/public/queue/route.ts", import.meta.url),
    "utf8",
  );
  const sessionQueueStart = sessionServiceSource.indexOf(
    "export async function getSessionQueue",
  );
  const sessionRequestStart = sessionServiceSource.indexOf(
    "export async function createSessionRequest",
  );
  const sessionQueueSource = sessionServiceSource.slice(
    sessionQueueStart,
    sessionRequestStart,
  );
  const hiddenSessionQueueStart = sessionQueueSource.lastIndexOf(
    "const items = await getDb()",
  );
  const hiddenSessionQueueSource = sessionQueueSource.slice(
    hiddenSessionQueueStart,
  );

  assert.match(sessionQueueSource, /session\.event\.publicShowSongTitles/);
  assert.match(sessionQueueSource, /showSongTitles: false as const/);
  assert.match(sessionQueueSource, /PUBLIC_QUEUE_VISIBLE_STATUSES/);
  assert.match(
    sessionQueueSource,
    /eq\(songRequests\.eventId, session\.event\.id\)/,
  );
  assert.doesNotMatch(hiddenSessionQueueSource, /songs\.title|songs\.artist/);
  assert.match(publicQueueRouteSource, /PUBLIC_QUEUE_ENDPOINT_GONE/);
  assert.doesNotMatch(publicQueueRouteSource, /getPublicQueue/);
});

test("event queue panel uses Supabase Realtime invalidation without polling", () => {
  const panelSource = readFileSync(
    new URL(
      "../src/components/operator/event-queue-panel.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(panelSource, /onClick=\{\(\) => void refreshQueue\(\)\}/);
  assert.match(panelSource, /useDashboardQueueRealtime/);
  assert.match(panelSource, /pendingOperations/);
  assert.match(panelSource, /getDashboardEventQueueActionOperationKey/);
  assert.match(panelSource, /applyOptimisticDashboardEventQueueAction/);
  assert.match(panelSource, /restoreDashboardEventQueueItems/);
  assert.match(panelSource, /reconcileDashboardEventQueueItem/);
  assert.match(
    panelSource,
    /getDashboardEventQueue\(\s*organizationId,\s*eventId,\s*signal/s,
  );
  assert.doesNotMatch(panelSource, /const isBusy = pendingOperation !== null/);
  assert.doesNotMatch(panelSource, /disabled=\{pendingOperation !== null\}/);
  assert.doesNotMatch(panelSource, /setInterval|setTimeout|useEffect/);
  assert.match(panelSource, /Nie ma jeszcze zgłoszeń z linku sesji/);
});

test("event queue panel does not refetch the whole queue after each mutation", () => {
  const panelSource = readFileSync(
    new URL(
      "../src/components/operator/event-queue-panel.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const actionStart = panelSource.indexOf("async function handleAction");
  const moveStart = panelSource.indexOf("async function handleMove");
  const pendingStart = panelSource.indexOf("function markOperationPending");
  const actionSource = panelSource.slice(actionStart, moveStart);
  const moveSource = panelSource.slice(moveStart, pendingStart);

  assert.doesNotMatch(
    actionSource,
    /getDashboardEventQueue\(organizationId,\s*eventId\)/,
  );
  assert.doesNotMatch(
    moveSource,
    /getDashboardEventQueue\(organizationId,\s*eventId\)/,
  );
  assert.doesNotMatch(actionSource, /router\.refresh\(\)/);
  assert.doesNotMatch(moveSource, /router\.refresh\(\)/);
});

function makeQueueItem(
  overrides: Partial<DashboardEventQueueOptimisticItem> & { id: number },
): DashboardEventQueueOptimisticItem {
  return {
    id: overrides.id,
    status: overrides.status ?? "pending",
    position: overrides.position ?? 0,
    version: overrides.version ?? 1,
    createdAt: overrides.createdAt ?? "2026-07-06T17:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-06T17:00:00.000Z",
    startedAt: overrides.startedAt ?? null,
    completedAt: overrides.completedAt ?? null,
  };
}
