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
    serviceSource,
    /eq\(events\.id, eventId\), eq\(events\.workspaceId, organization\.id\)/,
  );
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

test("public session and global queues keep their existing privacy paths", () => {
  const sessionServiceSource = readFileSync(
    new URL("../src/server/session-api/service.ts", import.meta.url),
    "utf8",
  );
  const publicServiceSource = readFileSync(
    new URL("../src/server/public-api/service.ts", import.meta.url),
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
  assert.match(publicServiceSource, /export async function getPublicQueue/);
  assert.match(publicServiceSource, /showSongTitles: event\.publicShowSongTitles/);
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
  assert.match(
    panelSource,
    /getDashboardEventQueue\(\s*organizationId,\s*eventId,\s*signal/s,
  );
  assert.doesNotMatch(panelSource, /setInterval|setTimeout|useEffect/);
  assert.match(panelSource, /Nie ma jeszcze zgłoszeń z linku sesji/);
});
