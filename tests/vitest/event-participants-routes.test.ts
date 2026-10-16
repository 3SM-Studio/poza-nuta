import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn(), detail: vi.fn(), create: vi.fn(), request: vi.fn(), search: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/operator-api/supabase-session", () => ({ requireOperatorSession: mocks.session }));
vi.mock("@/server/operator-api/event-participants", () => ({
  listEventParticipants: mocks.list, listEventParticipantPresence: mocks.list, getEventParticipant: mocks.detail, createEventParticipant: mocks.create,
  createOperatorParticipantRequest: mocks.request, searchEventParticipantSongs: mocks.search,
}));

import { GET as list, POST as create } from "@/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/route";
import { GET as detail } from "@/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/[participantId]/route";
import { POST as addRequest } from "@/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/[participantId]/requests/route";
import { GET as search } from "@/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/songs/route";
import { GET as presence } from "@/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/presence/route";
import { OperatorApiError } from "@/server/operator-api/errors";

const eventId = "4b35d0f4-ac40-4fbc-b508-09a3786fb5d8";
const params = { organizationId: "participanttest00001", eventId, participantId: "12" };
const context = { params: Promise.resolve(params) };
const origin = "http://localhost:3000";
const endpoint = `${origin}/api/dashboard/organizations/${params.organizationId}/events/${eventId}/participants`;
function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(endpoint, { method: "POST", headers: { host: "localhost:3000", origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

describe("event participant routes", () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("SITE_URL", origin);
    mocks.session.mockResolvedValue({ authUser: { id: "server-auth-id" } });
    mocks.list.mockResolvedValue({ items: [] });
    mocks.detail.mockResolvedValue({ participant: { id: 12 }, requests: [] });
    mocks.create.mockResolvedValue({ participant: { id: 12 } });
    mocks.request.mockResolvedValue({ request: { id: 8, status: "pending" } });
    mocks.search.mockResolvedValue({ items: [] });
  });

  it("requires a verified operator session for every endpoint", async () => {
    mocks.session.mockRejectedValue(new OperatorApiError(401, "UNAUTHENTICATED", "Sign in."));
    for (const handler of [list, create, detail, addRequest, search, presence]) {
      const response = await handler(request({ songId: 1 }), context);
      expect(response.status).toBe(401);
    }
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
  });

  it("rejects cross-origin and non-JSON mutations", async () => {
    expect((await create(request({ displayName: "Test" }, { origin: "https://attacker.example" }), context)).status).toBe(403);
    expect((await addRequest(request({ songId: 2 }, { "content-type": "text/plain" }), context)).status).toBe(415);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
  });

  it("does not accept a client identity, role, source, title or artist", async () => {
    for (const extra of [{ participantId: 3 }, { role: "owner" }, { requestedBy: "public" }, { title: "Fake" }, { artist: "Fake" }]) {
      expect((await addRequest(request({ songId: 2, ...extra }), context)).status).toBe(400);
    }
    expect((await create(request({ displayName: "Test", participantIdentityId: 3 }), context)).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
  });

  it("validates identifiers and malformed JSON without reaching services", async () => {
    for (const participantId of ["0", "-1", "NaN", "1.2", "9007199254740992"]) {
      expect((await detail(new NextRequest(endpoint), { params: Promise.resolve({ ...params, participantId }) })).status).toBe(400);
    }
    expect((await list(new NextRequest(endpoint), { params: Promise.resolve({ ...params, eventId: "1" }) })).status).toBe(400);
    const malformed = new NextRequest(endpoint, { method: "POST", headers: { host: "localhost:3000", origin, "content-type": "application/json" }, body: "{" });
    expect((await create(malformed, context)).status).toBe(400);
  });

  it("passes server identity and scoped IDs only, with no-store responses", async () => {
    const created = await create(request({ displayName: "  Test Singer  " }), context);
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    expect(mocks.create).toHaveBeenCalledWith({ authUserId: "server-auth-id", organizationId: params.organizationId, eventId, displayName: "Test Singer" });
    expect((await addRequest(request({ songId: 2 }), context)).status).toBe(201);
    expect(mocks.request).toHaveBeenCalledWith({ authUserId: "server-auth-id", organizationId: params.organizationId, eventId, participantId: 12, songId: 2 });
    expect((await detail(new NextRequest(endpoint), context)).status).toBe(200);
    expect((await search(new NextRequest(`${endpoint}/songs?q=ABBA`), context)).status).toBe(200);
    expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({ query: "abba" }));
  });

  it.each([[403, "WORKSPACE_EVENT_QUEUE_MANAGE_FORBIDDEN"], [404, "EVENT_PARTICIPANT_NOT_FOUND"], [409, "SESSION_REQUEST_LIMIT_REACHED"]] as const)("preserves safe service error %s %s", async (status, code) => {
    mocks.request.mockRejectedValue(new OperatorApiError(status, code, "Safe message."));
    const response = await addRequest(request({ songId: 2 }), context);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code, message: "Safe message." } });
  });
});
