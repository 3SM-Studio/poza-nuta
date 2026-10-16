import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OperatorApiError } from "@/server/operator-api/errors";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn(), session: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/operator-api/fair-queue", () => ({ previewFairEventQueue: mocks.preview, applyFairEventQueue: mocks.apply }));
vi.mock("@/server/operator-api/supabase-session", () => ({ requireOperatorSession: mocks.session }));
import { POST } from "@/app/api/dashboard/organizations/[organizationId]/events/[eventId]/queue/fair/route";
const origin = "http://localhost:3000", revision = "a".repeat(64);
const eventId = "48dce444-432f-4fb9-b920-7d4810c9b683";
const context = { params: Promise.resolve({ organizationId: "participanttest00001", eventId }) };
const request = (body: unknown, headers: Record<string, string> = {}) => new NextRequest(`${origin}/api/dashboard/organizations/participanttest00001/events/${eventId}/queue/fair`, {
  method: "POST", headers: { origin, host: "localhost:3000", "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("SITE_URL", origin); mocks.session.mockResolvedValue({ authUser: { id: "verified-user" } }); });
afterEach(() => vi.unstubAllEnvs());
it("previews without mutation and applies only a revision with verified server identity", async () => {
  mocks.preview.mockResolvedValue({ revision, changes: [] });
  let result = await POST(request({ action: "preview" }), context);
  expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
  expect(mocks.preview).toHaveBeenCalledWith({ authUserId: "verified-user", organizationId: "participanttest00001", eventId });
  expect(mocks.apply).not.toHaveBeenCalled();
  mocks.apply.mockResolvedValue({ changed: 0, items: [] });
  result = await POST(request({ action: "apply", revision }), context);
  expect(result.status).toBe(200);
  expect(mocks.apply).toHaveBeenCalledWith({ authUserId: "verified-user", organizationId: "participanttest00001", eventId, revision });
});
it("rejects forged roles, replacement orders, invalid revisions and oversized bodies", async () => {
  for (const body of [{ action: "preview", role: "owner" }, { action: "apply", revision, order: [1] }, { action: "apply", revision: "x" }, { action: "preview", ignored: "x".repeat(2000) }, [], null]) {
    expect((await POST(request(body), context)).status).toBe(400);
  }
  expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled();
});
it("rejects CSRF, non-JSON and unauthenticated access before the service", async () => {
  expect((await POST(request({ action: "preview" }, { origin: "https://foreign.example" }), context)).status).toBe(403);
  expect((await POST(request({ action: "preview" }, { "content-type": "text/plain" }), context)).status).toBe(415);
  mocks.session.mockRejectedValue(new OperatorApiError(401, "AUTH_REQUIRED", "Sign in."));
  expect((await POST(request({ action: "preview" }), context)).status).toBe(401);
  expect(mocks.preview).not.toHaveBeenCalled();
});
it("preserves safe stale-preview and viewer denials without returning an order", async () => {
  mocks.apply.mockRejectedValue(new OperatorApiError(409, "FAIR_QUEUE_PREVIEW_STALE", "Prepare a new preview."));
  const stale = await POST(request({ action: "apply", revision }), context);
  expect(stale.status).toBe(409); expect((await stale.json()).error.code).toBe("FAIR_QUEUE_PREVIEW_STALE");
  mocks.preview.mockRejectedValue(new OperatorApiError(403, "WORKSPACE_EVENT_QUEUE_MANAGE_FORBIDDEN", "Unavailable."));
  expect((await POST(request({ action: "preview" }), context)).status).toBe(403);
});
