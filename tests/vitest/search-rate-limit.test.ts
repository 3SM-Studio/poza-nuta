import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/server/public-api/service", () => ({ searchPublicSongs: vi.fn(async () => ({ items: [], nextCursor: null })) }));
import { GET } from "../../src/app/api/public/songs/search/route";
import { searchPublicSongs } from "../../src/server/public-api/service";
import { consumeSessionRateLimit, resetSessionRateLimitForTests } from "../../src/server/session-api/rate-limit-core";
import { requireSessionApiRateLimit } from "../../src/server/session-api/rate-limit";
import { randomBytes } from "node:crypto";

test("public catalog search rejects request 121 before invoking SQL and validates input", async () => {
  resetSessionRateLimitForTests(); vi.mocked(searchPublicSongs).mockClear();
  const request = () => new Request("http://localhost/api/public/songs/search?q=queen");
  for (let i=0;i<120;i++) expect((await GET(request())).status).toBe(200);
  const denied = await GET(request());
  expect(denied.status).toBe(429);
  expect(await denied.json()).toEqual({ error: { code: "SESSION_RATE_LIMITED", message: "The session could not be opened." } });
  expect(searchPublicSongs).toHaveBeenCalledTimes(120);
  expect((await GET(new Request("http://localhost/api/public/songs/search?q="+"a".repeat(101)))).status).toBe(400);
  expect(searchPublicSongs).toHaveBeenCalledTimes(120);
  resetSessionRateLimitForTests();
});

test("20 participants behind one network have independent search budgets, parallel requests cannot overshoot", async () => {
  resetSessionRateLimitForTests();
  const devices = Array.from({length:20}, () => randomBytes(32).toString('base64url'));
  const request = (device: string) => new Request('http://localhost/api/s/test/songs/search?q=queen', {
    headers: { cookie: `poza_nuta_participant=${device}`, 'x-forwarded-for': '192.0.2.1' },
  });
  const results = await Promise.all(devices.flatMap(device => Array.from({length:100}, async () => {
    requireSessionApiRateLimit(request(device), 'search'); return true;
  })));
  expect(results).toHaveLength(2000);
  resetSessionRateLimitForTests();
  const device = devices[0];
  const burst = await Promise.allSettled(Array.from({length:150}, async () => requireSessionApiRateLimit(request(device), 'search')));
  expect(burst.filter(r => r.status==='fulfilled')).toHaveLength(120);
  expect(burst.filter(r => r.status==='rejected')).toHaveLength(30);
  // Search does not consume the mutation/queue API quota for the venue.
  expect(() => requireSessionApiRateLimit(request(device))).not.toThrow();
  resetSessionRateLimitForTests();
  for (let i=0;i<2400;i++) requireSessionApiRateLimit(request(randomBytes(32).toString('base64url')), 'search');
  expect(() => requireSessionApiRateLimit(request(devices[1]), 'search')).toThrow();
  resetSessionRateLimitForTests();
});

test("anonymous API bucket capacity fails closed and expired buckets are reclaimed", () => {
  resetSessionRateLimitForTests();
  for (let i=0;i<10_000;i++) expect(consumeSessionRateLimit({ scope: "api", key: String(i), now: 1000 }).allowed).toBe(true);
  expect(consumeSessionRateLimit({ scope: "api", key: "overflow", now: 1000 }).allowed).toBe(false);
  expect(consumeSessionRateLimit({ scope: "api", key: "after-expiry", now: 61_000 }).allowed).toBe(true);
  resetSessionRateLimitForTests();
  for (let i=0;i<10_000;i++) consumeSessionRateLimit({scope:"search",key:String(i),now:1000});
  expect(consumeSessionRateLimit({scope:"search",key:"overflow",now:1000}).allowed).toBe(false);
  expect(consumeSessionRateLimit({scope:"api",key:"queue",now:1000}).allowed).toBe(true);
  resetSessionRateLimitForTests();
});

test("wrapped PostgreSQL cancellation is a safe 503, never an empty success or leaked SQL", async () => {
  resetSessionRateLimitForTests();
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  try {
    const driver=Object.assign(new Error('canceling statement due to statement timeout'),{code:'57014'});
    vi.mocked(searchPublicSongs).mockRejectedValueOnce(new Error('SQL and private bound values must not escape',{cause:driver}));
    const response=await GET(new Request('http://localhost/api/public/songs/search?q=queen'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({error:{code:'SERVICE_UNAVAILABLE',message:'The service is temporarily unavailable.'}});
    expect(log).toHaveBeenCalledWith(expect.stringContaining('error_code="57014"'));
    expect(log.mock.calls.flat().join(' ')).not.toContain('private bound values');
  } finally { log.mockRestore(); resetSessionRateLimitForTests(); }
});
