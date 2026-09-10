import { describe, expect, it } from "vitest";

import {
  normalizeTelemetryUrl,
  redactTelemetryEvent,
  shouldTrackTelemetryUrl,
} from "@/lib/telemetry-url";

const publicToken = "AbCdEfGhIjKlMnOpQrStUv";

describe("telemetry URL redaction", () => {
  it("leaves non-sensitive public paths unchanged", () => {
    expect(normalizeTelemetryUrl("/")).toBe("/");
    expect(normalizeTelemetryUrl("/events/example")).toBe("/events/example");
  });

  it("redacts participant capability tokens while preserving the route shape", () => {
    expect(normalizeTelemetryUrl(`/s/${publicToken}`)).toBe("/s/[token]");
    expect(normalizeTelemetryUrl(`/s/${publicToken}/songs`)).toBe(
      "/s/[token]/songs",
    );
  });

  it("redacts join and session codes", () => {
    expect(normalizeTelemetryUrl("/join/12345678")).toBe("/join/[code]");
    expect(normalizeTelemetryUrl("/session/12345678")).toBe(
      "/session/[code]",
    );
  });

  it("keeps only privacy-safe query structure", () => {
    expect(
      normalizeTelemetryUrl(
        `/s/${publicToken}/songs?q=abba&genre=pop&language=pl&duet=true&hit=false&sort=artist&cursor=opaque&access_token=secret&code=12345678`,
      ),
    ).toBe(
      "/s/[token]/songs?q=[query]&genre=[genre]&language=[language]&duet=true&hit=false&sort=artist",
    );
  });

  it("excludes private and malformed URLs from telemetry", () => {
    expect(shouldTrackTelemetryUrl("/dashboard/org/example")).toBe(false);
    expect(shouldTrackTelemetryUrl("/admin")).toBe(false);
    expect(shouldTrackTelemetryUrl("/sign-in?code=secret")).toBe(false);
    expect(shouldTrackTelemetryUrl("javascript:alert(1)")).toBe(false);
    expect(
      redactTelemetryEvent({
        type: "pageview" as const,
        url: "/dashboard/org/example",
      }),
    ).toBeNull();
  });
});
