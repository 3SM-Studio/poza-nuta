import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRateLimit, resolveJoinCode } = vi.hoisted(() => ({
  requireRateLimit: vi.fn(),
  resolveJoinCode: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/session-api/rate-limit", () => ({
  requireSessionApiRateLimit: requireRateLimit,
}));
vi.mock("@/server/session-api/service", () => ({ resolveJoinCode }));
vi.mock("@/server/runtime-diagnostics", () => ({
  traceServerStep: (_scope: string, _step: string, run: () => unknown) => run(),
}));

import { PublicApiError } from "@/server/public-api/errors";
import { resolveJoinCodeResponse } from "@/server/session-api/code-resolver-response";

describe("join code resolver response", () => {
  beforeEach(() => {
    requireRateLimit.mockReset();
    resolveJoinCode.mockReset();
  });

  it("returns typed JSON for client resolution without changing direct redirect behavior", async () => {
    resolveJoinCode.mockResolvedValue({ status: "invalid" });
    const jsonResponse = await resolveJoinCodeResponse(
      new Request("http://localhost/join/123456", { headers: { Accept: "application/json" } }),
      "123456",
    );
    expect(jsonResponse.status).toBe(404);
    await expect(jsonResponse.json()).resolves.toEqual({ status: "error", error: "invalid" });

    const redirectResponse = await resolveJoinCodeResponse(
      new Request("http://localhost/join/123456"),
      "123456",
    );
    expect(redirectResponse.status).toBe(307);
    expect(redirectResponse.headers.get("location")).toBe("/join?joinError=invalid");
  });

  it("returns a resolved location and a typed rate-limit error", async () => {
    resolveJoinCode.mockResolvedValueOnce({ status: "resolved", publicToken: "public-token" });
    const resolved = await resolveJoinCodeResponse(
      new Request("http://localhost/join/004271", { headers: { Accept: "application/json" } }),
      "004271",
    );
    await expect(resolved.json()).resolves.toEqual({ status: "resolved", location: "/s/public-token" });

    requireRateLimit.mockImplementationOnce(() => {
      throw new PublicApiError(429, "SESSION_RATE_LIMITED", "limited");
    });
    const limited = await resolveJoinCodeResponse(
      new Request("http://localhost/join/004271", { headers: { Accept: "application/json" } }),
      "004271",
    );
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toEqual({ status: "error", error: "rate-limited" });
  });
});
