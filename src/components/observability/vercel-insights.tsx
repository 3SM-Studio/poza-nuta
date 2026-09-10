"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { redactTelemetryEvent } from "@/lib/telemetry-url";

export function VercelInsights() {
  return (
    <>
      <Analytics beforeSend={redactTelemetryEvent} />
      <SpeedInsights beforeSend={redactTelemetryEvent} />
    </>
  );
}
