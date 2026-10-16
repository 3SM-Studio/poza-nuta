import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicApiError } from "@/server/public-api/errors";
import { OperatorApiError } from "@/server/operator-api/errors";
import { resetSessionRateLimitForTests } from "@/server/session-api/rate-limit-core";

const mocks = vi.hoisted(() => ({ issue: vi.fn(), prepare: vi.fn(), approve: vi.fn(), finish: vi.fn(), cancel: vi.fn(), state: vi.fn(), own: vi.fn(), consent: vi.fn(), session: vi.fn(), propose: vi.fn(), proposal: vi.fn(), complete: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/session-api/linking", () => ({ LINK_CHALLENGE_COOKIE: "poza_nuta_device_link", issueDeviceLink: mocks.issue, prepareDeviceLink: mocks.prepare, approveDeviceLink: mocks.approve, finishDeviceLink: mocks.finish, cancelDeviceLink: mocks.cancel, getDeviceLinkState: mocks.state }));
vi.mock("@/server/operator-api/participant-merge", () => ({ getOwnMergeProposals: mocks.own, consentParticipantMerge: mocks.consent, createParticipantMergeProposal: mocks.propose, getParticipantMergeProposal: mocks.proposal, completeParticipantMerge: mocks.complete }));
vi.mock("@/server/operator-api/supabase-session", () => ({ requireOperatorSession: mocks.session }));
import { GET, POST } from "@/app/api/s/[token]/identity/linking/route";
import { GET as own, POST as consent } from "@/app/api/s/[token]/identity/merges/route";
import { POST as propose } from "@/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/merges/route";
import { GET as proposal, POST as complete } from "@/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/merges/[proposalId]/route";

const origin = "http://localhost:3000", token = "A".repeat(22), id = "48dce444-432f-4fb9-b920-7d4810c9b683";
const credential = "c".repeat(43), challenge = "h".repeat(43);
const context = { params: Promise.resolve({ token }) };
const operatorContext = { params: Promise.resolve({ organizationId: "participanttest00001", eventId: id, proposalId: id }) };
function request(body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/s/${token}/identity/linking`, { method: body === undefined ? "GET" : "POST", headers: { origin, host: "localhost:3000", "content-type": "application/json", cookie: `poza_nuta_participant=${credential}; poza_nuta_device_link=${challenge}`, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
describe("Slice 4 identity routes", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("SITE_URL", origin); resetSessionRateLimitForTests(); mocks.session.mockResolvedValue({ authUser: { id: "server-user" } }); mocks.state.mockResolvedValue({ issued: [], received: null }); });
  afterEach(() => vi.unstubAllEnvs());
  it("sets independent credentials only in HttpOnly cookies and returns no secrets on finish", async () => {
    mocks.finish.mockResolvedValue({ credential: "n".repeat(43), credentialExpiresAt: new Date(Date.now() + 100_000) });
    const result = await POST(request({ action: "finish", id }), context);
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ linked: true });
    const cookie = result.headers.get("set-cookie");
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=lax"); expect(cookie).toContain("Path=/");
    expect(mocks.finish).toHaveBeenCalledWith(token, credential, id, challenge);
    expect(result.headers.get("cache-control")).toBe("no-store"); expect(result.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("keeps the receiver challenge out of JSON and binds it in a short HttpOnly cookie", async () => {
    mocks.prepare.mockResolvedValue({ challenge, link: { id, expiresAt: new Date(Date.now() + 180_000), comparisonCode: "123456" } });
    const result = await POST(request({ action: "prepare", token: "t".repeat(43) }), context);
    expect(result.status).toBe(200); expect(JSON.stringify(await result.json())).not.toContain(challenge);
    expect(result.headers.get("set-cookie")).toContain("HttpOnly"); expect(result.headers.get("set-cookie")).toContain("SameSite=strict"); expect(result.headers.get("set-cookie")).toContain("Path=/api/s");
  });
  it("rejects CSRF, unknown fields, roles, credentials and oversized input before business actions", async () => {
    expect((await POST(request({ action: "issue" }, { origin: "https://foreign.example" }), context)).status).toBe(403);
    expect((await POST(request({ action: "issue" }, { "content-type": "text/plain" }), context)).status).toBe(415);
    for (const body of [{ action: "issue", participantId: 1 }, { action: "finish", id, credential }, { action: "approve", id, code: "123456", role: "owner" }, { action: "prepare", token: "x".repeat(2000) }, null, { action: "delete" }]) expect((await POST(request(body), context)).status).toBe(400);
    expect(mocks.issue).not.toHaveBeenCalled(); expect(mocks.finish).not.toHaveBeenCalled(); expect(mocks.approve).not.toHaveBeenCalled();
  });
  it("uses a bounded budget for both source IP and credential without consuming the queue budget", async () => {
    for (let i = 0; i < 60; i++) expect((await GET(request(), context)).status).toBe(200);
    expect((await GET(request(), context)).status).toBe(429); expect(mocks.state).toHaveBeenCalledTimes(60);
  });
  it("requires verified operator auth, passes server identity and validates proposal bodies", async () => {
    mocks.propose.mockResolvedValue({ id });
    expect((await propose(request({ sourceId: 12, targetId: 13 }), operatorContext)).status).toBe(201);
    expect(mocks.propose).toHaveBeenCalledWith({ authUserId: "server-user", organizationId: "participanttest00001", eventId: id, sourceId: 12, targetId: 13 });
    expect((await propose(request({ sourceId: 12, targetId: 13, sourceConsented: true }), operatorContext)).status).toBe(400);
    expect((await complete(request({ action: "complete", force: true }), operatorContext)).status).toBe(400);
    mocks.session.mockRejectedValue(new OperatorApiError(401, "UNAUTHENTICATED", "Sign in."));
    for (const handler of [propose, complete, proposal]) expect((await handler(request({ action: "complete" }), operatorContext)).status).toBe(401);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("public consent cannot supply identity and preserves safe scope failures", async () => {
    expect((await consent(request({ id, approve: true, participantId: 9 }), context)).status).toBe(400);
    mocks.consent.mockRejectedValue(new PublicApiError(403, "PARTICIPANT_MERGE_FORBIDDEN", "Not yours."));
    expect((await consent(request({ id, approve: true }), context)).status).toBe(403);
    mocks.own.mockRejectedValue(new OperatorApiError(404, "PARTICIPANT_MERGE_NOT_FOUND", "Unavailable."));
    expect((await own(request(), context)).status).toBe(404);
  });
});
