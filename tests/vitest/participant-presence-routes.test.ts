import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicApiError } from "@/server/public-api/errors";
import { consumeSessionRateLimit, resetSessionRateLimitForTests } from "@/server/session-api/rate-limit-core";
import { POST } from "@/app/api/s/[token]/presence/route";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/session-api/presence", () => ({ mutateParticipantPresence: mutate }));
const origin = "http://localhost:3000";
const token = "A".repeat(22), connectionId = "48dce444-432f-4fb9-b920-7d4810c9b683";
const credential = "a".repeat(43);
const context = { params: Promise.resolve({ token }) };
function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/s/${token}/presence`, {
    method: "POST", body: JSON.stringify(body),
    headers: { origin, host: "localhost:3000", "content-type": "application/json", cookie: `poza_nuta_participant=${credential}`, ...headers },
  });
}

describe("participant presence API", () => {
  beforeEach(() => { vi.stubEnv("SITE_URL", origin); resetSessionRateLimitForTests(); mutate.mockReset().mockResolvedValue({ online: true }); });
  afterEach(() => vi.unstubAllEnvs());
  it.each(["connect", "heartbeat", "disconnect"])("accepts %s through the cookie, not a supplied participant ID", async action => {
    const response = await POST(request({ connectionId, action }), context);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mutate).toHaveBeenCalledWith(token, credential, { connectionId, action });
  });
  it("rejects CSRF, absent origin and non-JSON beacon bodies", async () => {
    const cases: Record<string, string>[] = [{ origin: "https://foreign.example" }, { origin: "null" }, { "content-type": "text/plain" }];
    for (const headers of cases) {
      expect((await POST(request({ connectionId, action: "connect" }, headers), context)).status).toBe(headers["content-type"] ? 415 : 403);
    }
    const missing = request({ connectionId, action: "connect" });
    missing.headers.delete("origin");
    expect((await POST(missing, context)).status).toBe(403);
    expect(mutate).not.toHaveBeenCalled();
  });
  it("rejects forged identities, malformed IDs, oversized input and unknown actions", async () => {
    for (const body of [{ connectionId, action: "connect", eventParticipantId: 7 }, { connectionId: "7", action: "heartbeat" },
      { connectionId, action: "delete" }, { connectionId: "x".repeat(300), action: "connect" }, null]) {
      expect((await POST(request(body), context)).status).toBe(400);
    }
    expect(mutate).not.toHaveBeenCalled();
  });
  it("has a separate per-credential heartbeat budget", async () => {
    for (let i = 0; i < 240; i++) expect((await POST(request({ connectionId, action: "heartbeat" }), context)).status).toBe(200);
    expect((await POST(request({ connectionId, action: "heartbeat" }), context)).status).toBe(429);
    expect(mutate).toHaveBeenCalledTimes(240);
  });
  it("bounds server memory for presence keys and releases expired entries", () => {
    for (let i = 0; i < 10_000; i++) expect(consumeSessionRateLimit({ scope: "presence", key: `test-${i}`, now: 100 }).allowed).toBe(true);
    expect(consumeSessionRateLimit({ scope: "presence", key: "new-key", now: 100 }).allowed).toBe(false);
    expect(consumeSessionRateLimit({ scope: "presence", key: "test-0", now: 100 }).allowed).toBe(true);
    expect(consumeSessionRateLimit({ scope: "presence", key: "new-key", now: 60_101 }).allowed).toBe(true);
  });
  it.each([[403, "SESSION_PARTICIPANT_REQUIRED"], [403, "SESSION_EVENT_CLOSED"], [409, "SESSION_CONNECTION_ENDED"]] as const)("preserves safe authorization/lifecycle response %s %s", async (status, code) => {
    mutate.mockRejectedValueOnce(new PublicApiError(status, code, "Safe message."));
    const response = await POST(request({ connectionId, action: "heartbeat" }), context);
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: { code, message: "Safe message." } });
  });
});
