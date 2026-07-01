import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type AppEnv = {
  songIndexPath: string;
  karafunCsvPath: string;
  karafunImportReportPath: string;
  isingClientId?: string;
  apiHost: string;
  apiPort: number;
  apiAdminToken?: string;
  apiLogLevel: "silent" | "info" | "debug";
  isingApiBaseUrl: string;
  isingImportDelayMs: number;
  isingImportTag: string;
  isingImportOrder: string;
  isingImportContactEmail?: string;
  isingImportUserAgent?: string;
};

export type RawEnv = Record<string, string | undefined>;

const DEFAULTS = {
  songIndexPath: "data/imports/songs.json",
  karafunCsvPath: "data/sources/karafuncatalog.csv",
  karafunImportReportPath: "data/imports/karafun-import-report.json",
  apiHost: "127.0.0.1",
  apiPort: 4321,
  apiLogLevel: "info" as const,
  isingApiBaseUrl: "https://api.ising.pl/v2",
  isingImportDelayMs: 3000,
  isingImportTag: "",
  isingImportOrder: "-artist_string"
};

export async function loadAppEnv(envPath = ".env", processEnv: RawEnv = process.env): Promise<AppEnv> {
  return parseAppEnv({ ...(await readEnvFile(envPath)), ...processEnv });
}

export function parseAppEnv(env: RawEnv): AppEnv {
  return {
    songIndexPath: resolve(optionalText(env.SONG_INDEX_PATH) ?? DEFAULTS.songIndexPath),
    karafunCsvPath: resolve(optionalText(env.KARAFUN_CSV_PATH) ?? DEFAULTS.karafunCsvPath),
    karafunImportReportPath: resolve(optionalText(env.KARAFUN_IMPORT_REPORT_PATH) ?? DEFAULTS.karafunImportReportPath),
    isingClientId: optionalText(env.ISING_CLIENT_ID),
    apiHost: optionalText(env.API_HOST) ?? DEFAULTS.apiHost,
    apiPort: parsePort(env.API_PORT, DEFAULTS.apiPort),
    apiAdminToken: optionalText(env.API_ADMIN_TOKEN),
    apiLogLevel: parseLogLevel(env.API_LOG_LEVEL),
    isingApiBaseUrl: optionalText(env.ISING_API_BASE_URL) ?? DEFAULTS.isingApiBaseUrl,
    isingImportDelayMs: parsePositiveInteger(env.ISING_IMPORT_DELAY_MS, DEFAULTS.isingImportDelayMs),
    isingImportTag: optionalText(env.ISING_IMPORT_TAG) ?? DEFAULTS.isingImportTag,
    isingImportOrder: optionalText(env.ISING_IMPORT_ORDER) ?? DEFAULTS.isingImportOrder,
    isingImportContactEmail: optionalText(env.ISING_IMPORT_CONTACT_EMAIL),
    isingImportUserAgent: optionalText(env.ISING_IMPORT_USER_AGENT)
  };
}

export async function readEnvFile(path: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(path, "utf8");
    const env: Record<string, string> = {};

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      env[trimmed.slice(0, separatorIndex).trim()] = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    }

    return env;
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }
    throw error;
  }
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseLogLevel(value: string | undefined): AppEnv["apiLogLevel"] {
  return value === "silent" || value === "info" || value === "debug" ? value : DEFAULTS.apiLogLevel;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed !== "replace_me" ? trimmed : undefined;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
