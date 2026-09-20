import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  cancelPublicParticipantRequest,
  createPublicSessionRequest,
  joinPublicSession,
  renamePublicSessionParticipant,
  requireSessionApiRateLimit,
} = vi.hoisted(() => ({
  cancelPublicParticipantRequest: vi.fn(),
  createPublicSessionRequest: vi.fn(),
  joinPublicSession: vi.fn(),
  renamePublicSessionParticipant: vi.fn(),
  requireSessionApiRateLimit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/session-api/rate-limit", () => ({
  requireSessionApiRateLimit,
}));
vi.mock("@/server/session-api/service", () => ({
  cancelPublicParticipantRequest,
  createPublicSessionRequest,
  getPublicSessionParticipant: vi.fn(),
  joinPublicSession,
  renamePublicSessionParticipant,
}));

import { DELETE as cancelRequest } from "@/app/api/s/[token]/requests/[requestId]/route";
import { POST as joinSession } from "@/app/api/s/[token]/join/route";
import { PATCH as renameParticipant } from "@/app/api/s/[token]/participant/route";
import { POST as createRequest } from "@/app/api/s/[token]/requests/route";
import { PublicApiError } from "@/server/public-api/errors";
import { requireParticipantMutationRequest } from "@/server/session-api/http";
import {
  isParticipantMutationRequestOriginAllowed,
  resolveParticipantMutationAllowedOrigins,
  type ParticipantMutationOriginEnvironment,
} from "@/server/session-api/participant-mutation-origin";

const SITE_ORIGIN = "https://pozanuta.example";
const DEPLOYMENT_HOST = "pozanuta-a1b2c3-atypicalmichas.vercel.app";
const BRANCH_HOST =
  "pozanuta-git-feat-professional-song-search-atypicalmichas.vercel.app";

describe("participant mutation origin policy", () => {
  it("allows only the canonical SITE_URL in production", () => {
    const allowedOrigins = resolveParticipantMutationAllowedOrigins(
      environment({ VERCEL_ENV: "production" }),
    );

    expect(matches(SITE_ORIGIN, SITE_ORIGIN, "pozanuta.example", allowedOrigins)).toBe(true);
    expect(
      matches("https://attacker.example", SITE_ORIGIN, "pozanuta.example", allowedOrigins),
    ).toBe(false);
    expect(matches(SITE_ORIGIN, SITE_ORIGIN, "attacker.example", allowedOrigins)).toBe(false);
    expect(
      matches(
        `https://${BRANCH_HOST}`,
        `https://${BRANCH_HOST}/api/s/token/join`,
        BRANCH_HOST,
        allowedOrigins,
      ),
    ).toBe(false);
  });

  it("allows the canonical, deployment, and branch origins exactly in Preview", () => {
    const allowedOrigins = resolveParticipantMutationAllowedOrigins(environment());

    expect(matches(SITE_ORIGIN, SITE_ORIGIN, "pozanuta.example", allowedOrigins)).toBe(true);
    expect(
      matches(
        `https://${DEPLOYMENT_HOST}`,
        `https://${DEPLOYMENT_HOST}/api/s/token/join`,
        DEPLOYMENT_HOST,
        allowedOrigins,
      ),
    ).toBe(true);
    expect(
      matches(
        `https://${BRANCH_HOST}`,
        `https://${BRANCH_HOST}/api/s/token/join`,
        BRANCH_HOST,
        allowedOrigins,
      ),
    ).toBe(true);
  });

  it("rejects arbitrary and suffix-confusion Preview-like hosts", () => {
    const allowedOrigins = resolveParticipantMutationAllowedOrigins(environment());
    const anotherProject = "another-project.vercel.app";
    const suffixConfusion = `${BRANCH_HOST}.attacker.example`;

    expect(
      matches(
        `https://${anotherProject}`,
        `https://${anotherProject}/api/s/token/join`,
        anotherProject,
        allowedOrigins,
      ),
    ).toBe(false);
    expect(
      matches(
        `https://${suffixConfusion}`,
        `https://${suffixConfusion}/api/s/token/join`,
        suffixConfusion,
        allowedOrigins,
      ),
    ).toBe(false);
  });

  it("ignores malformed VERCEL_URL and VERCEL_BRANCH_URL values", () => {
    const malformedDeployment = resolveParticipantMutationAllowedOrigins(
      environment({ VERCEL_URL: "https://bad.vercel.app/path" }),
    );
    const malformedBranch = resolveParticipantMutationAllowedOrigins(
      environment({ VERCEL_BRANCH_URL: "bad.vercel.app/path" }),
    );

    expect([...malformedDeployment]).toEqual([SITE_ORIGIN, `https://${BRANCH_HOST}`]);
    expect([...malformedBranch]).toEqual([SITE_ORIGIN, `https://${DEPLOYMENT_HOST}`]);
  });

  it("ignores missing Preview origins without changing canonical trust", () => {
    const allowedOrigins = resolveParticipantMutationAllowedOrigins(
      environment({ VERCEL_URL: undefined, VERCEL_BRANCH_URL: undefined }),
    );

    expect([...allowedOrigins]).toEqual([SITE_ORIGIN]);
  });

  it("rejects mixed allowed origins instead of combining their trust", () => {
    const allowedOrigins = resolveParticipantMutationAllowedOrigins(environment());

    expect(
      matches(
        `https://${DEPLOYMENT_HOST}`,
        `https://${BRANCH_HOST}/api/s/token/join`,
        BRANCH_HOST,
        allowedOrigins,
      ),
    ).toBe(false);
  });

  it("rejects a missing Origin and a non-HTTPS Preview request", () => {
    const allowedOrigins = resolveParticipantMutationAllowedOrigins(environment());

    expect(
      matches(
        null,
        `https://${DEPLOYMENT_HOST}/api/s/token/join`,
        DEPLOYMENT_HOST,
        allowedOrigins,
      ),
    ).toBe(false);
    expect(
      matches(
        `http://${DEPLOYMENT_HOST}`,
        `http://${DEPLOYMENT_HOST}/api/s/token/join`,
        DEPLOYMENT_HOST,
        allowedOrigins,
      ),
    ).toBe(false);
  });
});

describe("participant mutation request guard", () => {
  beforeEach(() => {
    vi.stubEnv("SITE_URL", SITE_ORIGIN);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", DEPLOYMENT_HOST);
    vi.stubEnv("VERCEL_BRANCH_URL", BRANCH_HOST);
    requireSessionApiRateLimit.mockReset();
    joinPublicSession.mockReset();
    renamePublicSessionParticipant.mockReset();
    createPublicSessionRequest.mockReset();
    cancelPublicParticipantRequest.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps application/json content-type enforcement unchanged", () => {
    expectGuardError(
      request(`https://${BRANCH_HOST}/api/s/token/join`, {
        host: BRANCH_HOST,
        origin: `https://${BRANCH_HOST}`,
        contentType: "text/plain",
      }),
      415,
      "SESSION_CONTENT_TYPE_UNSUPPORTED",
    );
  });

  it("keeps SITE_URL required even when Vercel Preview variables are present", () => {
    vi.stubEnv("SITE_URL", "");

    expectGuardError(
      request(`https://${BRANCH_HOST}/api/s/token/join`, {
        host: BRANCH_HOST,
        origin: `https://${BRANCH_HOST}`,
      }),
      503,
      "SESSION_CONFIGURATION_ERROR",
    );
  });

  it("lets a trusted Preview join reach validation without calling the service", async () => {
    const response = await joinSession(
      request(`https://${BRANCH_HOST}/api/s/invalid-safe-test-token/join`, {
        host: BRANCH_HOST,
        origin: `https://${BRANCH_HOST}`,
      }),
      { params: Promise.resolve({ token: "invalid-safe-test-token" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(joinPublicSession).not.toHaveBeenCalled();
  });

  it("rejects an untrusted Preview-like join before validation or service work", async () => {
    const untrustedHost = "another-project.vercel.app";
    const response = await joinSession(
      request(`https://${untrustedHost}/api/s/invalid-safe-test-token/join`, {
        host: untrustedHost,
        origin: `https://${untrustedHost}`,
      }),
      { params: Promise.resolve({ token: "invalid-safe-test-token" }) },
    );

    await expectOriginInvalid(response);
    expect(joinPublicSession).not.toHaveBeenCalled();
  });

  it("keeps join, rename, request creation, and cancellation behind the guard", async () => {
    const untrustedRequest = (path: string) =>
      request(`https://another-project.vercel.app${path}`, {
        host: "another-project.vercel.app",
        origin: "https://another-project.vercel.app",
      });

    const responses = await Promise.all([
      joinSession(untrustedRequest("/api/s/token/join"), {
        params: Promise.resolve({ token: "token" }),
      }),
      renameParticipant(untrustedRequest("/api/s/token/participant"), {
        params: Promise.resolve({ token: "token" }),
      }),
      createRequest(untrustedRequest("/api/s/token/requests"), {
        params: Promise.resolve({ token: "token" }),
      }),
      cancelRequest(
        untrustedRequest("/api/s/token/requests/00000000-0000-4000-8000-000000000000"),
        {
          params: Promise.resolve({
            token: "token",
            requestId: "00000000-0000-4000-8000-000000000000",
          }),
        },
      ),
    ]);

    for (const response of responses) await expectOriginInvalid(response);
    expect(joinPublicSession).not.toHaveBeenCalled();
    expect(renamePublicSessionParticipant).not.toHaveBeenCalled();
    expect(createPublicSessionRequest).not.toHaveBeenCalled();
    expect(cancelPublicParticipantRequest).not.toHaveBeenCalled();
  });
});

function environment(
  overrides: Partial<ParticipantMutationOriginEnvironment> = {},
): ParticipantMutationOriginEnvironment {
  return {
    SITE_URL: SITE_ORIGIN,
    VERCEL_ENV: "preview",
    VERCEL_URL: DEPLOYMENT_HOST,
    VERCEL_BRANCH_URL: BRANCH_HOST,
    ...overrides,
  };
}

function matches(
  origin: string | null,
  requestUrl: string,
  host: string | null,
  allowedOrigins: ReadonlySet<string>,
) {
  return isParticipantMutationRequestOriginAllowed(
    { origin, requestUrl, host },
    allowedOrigins,
  );
}

function request(
  url: string,
  options: { host: string; origin: string; contentType?: string },
) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": options.contentType ?? "application/json",
      host: options.host,
      origin: options.origin,
    },
    body: "{}",
  });
}

function expectGuardError(
  guardedRequest: NextRequest,
  status: number,
  code: string,
) {
  try {
    requireParticipantMutationRequest(guardedRequest);
    throw new Error("Expected participant mutation request to be rejected.");
  } catch (error) {
    expect(error).toBeInstanceOf(PublicApiError);
    expect(error).toMatchObject({ status, code });
  }
}

async function expectOriginInvalid(response: Response) {
  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toEqual({
    error: {
      code: "SESSION_ORIGIN_INVALID",
      message: "The request could not be completed.",
    },
  });
}
