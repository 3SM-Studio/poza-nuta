import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OperatorApiError } from "@/server/operator-api/errors";
const mocks = vi.hoisted(() => ({ place: vi.fn(), session: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/operator-api/event-queue", () => ({ placeDashboardEventQueueRequestForAuthUser: mocks.place }));
vi.mock("@/server/operator-api/supabase-session", () => ({ requireOperatorSession: mocks.session }));
import { POST } from "@/app/api/dashboard/organizations/[organizationId]/events/[eventId]/queue/requests/[requestId]/placement/route";
const origin = "http://localhost:3000";
const eventId = "48dce444-432f-4fb9-b920-7d4810c9b683";
const context = { params: Promise.resolve({ organizationId: "participanttest00001", eventId, requestId: "1" }) };
const input = { lane: "approved", position: 1, expectedRevision: "v1|1:1:pending:0" };
const request = (body: unknown, headers: Record<string, string> = {}) => new NextRequest(`${origin}/api/dashboard/organizations/participanttest00001/events/${eventId}/queue/requests/1/placement`, {
  method: "POST", headers: { origin, host: "localhost:3000", "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("SITE_URL", origin); mocks.session.mockResolvedValue({ authUser: { id: "verified-user" } }); });
afterEach(() => vi.unstubAllEnvs());
it("passes verified actor and exact placement once and returns canonical queue", async () => {
  mocks.place.mockResolvedValue({ items: [], request: { id: 1 } });
  const response = await POST(request(input), context);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.place).toHaveBeenCalledExactlyOnceWith({ authUserId: "verified-user", organizationId: "participanttest00001", eventId, requestId: 1, placement: input });
  expect((await response.json()).items).toEqual([]);
});
it("rejects forged roles, status now, missing confirmation, oversized bodies and non-integer positions", async () => {
  for (const patch of [{ role: "owner" }, { lane: "now" }, { lane: "rejected" }, { position: 1.5 }, { expectedRevision: "x".repeat(270_000) }])
    expect((await POST(request({ ...input, ...patch }), context)).status).toBe(400);
  expect(mocks.place).not.toHaveBeenCalled();
});
it("rejects CSRF, non-JSON, invalid IDs and missing session before mutation", async () => {
  expect((await POST(request(input, { origin: "https://foreign.example" }), context)).status).toBe(403);
  expect((await POST(request(input, { "content-type": "text/plain" }), context)).status).toBe(415);
  expect((await POST(request(input), { params: Promise.resolve({ organizationId: "participanttest00001", eventId, requestId: "0" }) })).status).toBe(400);
  mocks.session.mockRejectedValue(new OperatorApiError(401, "AUTH_REQUIRED", "Sign in."));
  expect((await POST(request(input), context)).status).toBe(401);
  expect(mocks.place).not.toHaveBeenCalled();
});
it("maps stale and viewer conflicts without leaking internals", async () => {
  for (const [status, code] of [[409, "QUEUE_PLACEMENT_STALE"], [403, "WORKSPACE_EVENT_QUEUE_MANAGE_FORBIDDEN"]] as const) {
    mocks.place.mockRejectedValue(new OperatorApiError(status, code, "Refresh the queue."));
    const response = await POST(request(input), context);
    expect(response.status).toBe(status); expect((await response.json()).error.code).toBe(code);
  }
});
