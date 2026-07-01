import { resolve } from "node:path";
import { loadAppEnv } from "../../config/env.ts";
import type { ISingImporterConfig } from "./types.ts";

export async function loadISingImporterConfig(envPath = ".env"): Promise<ISingImporterConfig> {
  const env = await loadAppEnv(envPath);

  return {
    apiBaseUrl: env.isingApiBaseUrl,
    clientId: requiredEnv(env.isingClientId, "ISING_CLIENT_ID"),
    delayMs: env.isingImportDelayMs,
    tag: env.isingImportTag,
    order: env.isingImportOrder,
    contactEmail: env.isingImportContactEmail,
    userAgent: env.isingImportUserAgent,
    outputSongsPath: resolve(env.songIndexPath),
    outputReportPath: resolve("data/imports/ising-import-report.json"),
    timeoutMs: 15_000,
    maxNetworkRetries: 1
  };
}

function requiredEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required env ${name}`);
  }
  return value;
}
