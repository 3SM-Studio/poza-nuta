import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const removedGlobalPaths = [
  "src/server/event-lifecycle.ts",
  "src/server/operator-api/service.ts",
  "src/server/operator-api/route-handlers.ts",
  "src/server/operator-api/transitions.ts",
  "src/app/api/dashboard/event/route.ts",
  "src/app/api/dashboard/event/start/route.ts",
  "src/app/api/dashboard/event/extend/route.ts",
  "src/app/api/dashboard/event/close/route.ts",
  "src/app/api/dashboard/queue/route.ts",
  "src/app/api/dashboard/requests/[requestId]/approve/route.ts",
  "src/app/api/dashboard/requests/[requestId]/done/route.ts",
  "src/app/api/dashboard/requests/[requestId]/reject/route.ts",
  "src/app/api/dashboard/requests/[requestId]/skip/route.ts",
  "src/app/api/dashboard/requests/[requestId]/start/route.ts",
  "src/app/api/operator/queue/route.ts",
  "src/app/api/operator/requests/[requestId]/approve/route.ts",
  "src/app/api/operator/requests/[requestId]/done/route.ts",
  "src/app/api/operator/requests/[requestId]/reject/route.ts",
  "src/app/api/operator/requests/[requestId]/skip/route.ts",
  "src/app/api/operator/requests/[requestId]/start/route.ts",
  "src/components/operator/dashboard-overview.tsx",
  "src/components/operator/event-settings.tsx",
  "src/components/operator/operator-queue.tsx",
] as const;

test("legacy global event lifecycle and queue clients are removed", () => {
  for (const path of removedGlobalPaths) {
    assert.equal(existsSync(path), false, `${path} must stay removed`);
  }

  const settingsRoute = readFileSync(
    "src/app/dashboard/settings/page.tsx",
    "utf8",
  );
  assert.match(settingsRoute, /redirect\("\/dashboard"\)/);
});

test("production event services never select the first active workspace event", () => {
  const serverSources = readSourceFiles("src/server");

  for (const { path, source } of serverSources) {
    assert.doesNotMatch(
      source,
      /eq\(events\.isActivePublicEvent,\s*true\)[\s\S]{0,800}\.limit\(1\)/,
      `${path} must not select an arbitrary active event`,
    );
    assert.doesNotMatch(source, /getActiveEventAfterLazyClose/);
    assert.doesNotMatch(source, /getActivePublicEventReadOnly/);
    assert.doesNotMatch(source, /requireActiveEventForUpdate/);
    assert.doesNotMatch(source, /closeExpiredActiveEventInTransaction/);
  }

  const schema = readFileSync("src/db/schema.ts", "utf8");
  assert.doesNotMatch(schema, /events_one_active_public_per_workspace_idx/);
});

test("lifecycle and queue mutations resolve a public event UUID and recheck RBAC after locking it", () => {
  const organizations = readFileSync(
    "src/server/operator-api/organizations.ts",
    "utf8",
  );
  const queue = readFileSync(
    "src/server/operator-api/event-queue.ts",
    "utf8",
  );

  for (const source of [organizations, queue]) {
    assert.match(source, /eventId: string/);
    assert.match(source, /parseDashboardEventIdentifier\(eventId\)/);
    assert.match(source, /eq\(events\.publicId, eventIdentifier\.value\)/);
    assert.doesNotMatch(source, /eq\(events\.id, identifier\.value\)/);
  }

  const lifecycleLock = organizations.indexOf('.for("update")');
  const lifecycleRecheck = organizations.indexOf(
    "const recheckedOrganization",
    lifecycleLock,
  );
  assert.ok(lifecycleLock >= 0 && lifecycleRecheck > lifecycleLock);

  const queueContext = queue.slice(
    queue.indexOf("async function requireEventQueueManagerContext"),
    queue.indexOf("async function requireDashboardEventQueueItem"),
  );
  assert.ok(
    queueContext.indexOf('.for("update")') <
      queueContext.indexOf("const recheckedOrganization"),
  );
  assert.match(organizations, /eventId: event\.id,\s*action:/s);
  assert.match(queue, /eventId: context\.event\.id,\s*action:/s);
});

function readSourceFiles(root: string) {
  const files: Array<{ path: string; source: string }> = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...readSourceFiles(path));
    } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
      files.push({ path, source: readFileSync(path, "utf8") });
    }
  }

  return files;
}
