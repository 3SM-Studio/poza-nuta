import { mapISingSong } from "./mapISingSong.ts";
import { upsertLocalSongs, writeImportReport } from "./persistence.ts";
import { ISingSafetyStopError, readAndValidateISingResponse, validateRawResponseText } from "./safety.ts";
import type { LocalSong } from "../../songs/types.ts";
import type { ISingImportReport, ISingImporterConfig } from "./types.ts";

type ImportDependencies = {
  fetchFn?: typeof fetch;
  delayFn?: (ms: number) => Promise<void>;
  nowFn?: () => Date;
  persistFn?: (outputPath: string, songs: LocalSong[]) => Promise<{ importedCount: number; skippedCount: number }>;
  writeReportFn?: (outputPath: string, report: ISingImportReport) => Promise<void>;
};

export class ISingImportStoppedError extends Error {
  readonly reason: string;
  readonly url: string;
  readonly report: ISingImportReport;

  constructor(reason: string, url: string, report: ISingImportReport) {
    super(reason);
    this.name = "ISingImportStoppedError";
    this.reason = reason;
    this.url = url;
    this.report = report;
  }
}

export async function importISingSongs(config: ISingImporterConfig, dependencies: ImportDependencies = {}): Promise<ISingImportReport> {
  const fetchFn = dependencies.fetchFn ?? fetch;
  const delayFn = dependencies.delayFn ?? delay;
  const nowFn = dependencies.nowFn ?? (() => new Date());
  const persistFn = dependencies.persistFn ?? upsertLocalSongs;
  const writeReportFn = dependencies.writeReportFn ?? writeImportReport;

  const startedAt = nowFn().toISOString();
  const report: ISingImportReport = {
    totalFoundFromApi: null,
    importedCount: 0,
    skippedCount: 0,
    pageCount: 0,
    startedAt,
    finishedAt: null,
    errors: []
  };

  const importedSongs: LocalSong[] = [];
  let nextUrl: string | null = buildInitialSearchUrl(config);

  try {
    while (nextUrl) {
      const response = await fetchWithRetry(nextUrl, config, fetchFn, delayFn);
      const page = await readAndValidateISingResponse(response, nextUrl);

      report.pageCount += 1;
      report.totalFoundFromApi ??= page.data.found;

      const checkedAt = nowFn().toISOString();
      importedSongs.push(...page.data.results.songs.map((song) => mapISingSong(song, checkedAt)));

      nextUrl = page.links?.next ? absolutizeUrl(page.links.next, config.apiBaseUrl) : null;
      if (nextUrl) {
        await delayFn(config.delayMs);
      }
    }

    const persistenceResult = await persistFn(config.outputSongsPath, dedupeSongs(importedSongs));
    report.importedCount = persistenceResult.importedCount;
    report.skippedCount = persistenceResult.skippedCount;
    report.finishedAt = nowFn().toISOString();
    await writeReportFn(config.outputReportPath, report);
    return report;
  } catch (error) {
    const stoppedError = toImportStoppedError(error, nextUrl ?? buildInitialSearchUrl(config), report, nowFn().toISOString());
    await writeReportFn(config.outputReportPath, stoppedError.report);
    throw stoppedError;
  }
}

export function buildInitialSearchUrl(config: ISingImporterConfig): string {
  const url = new URL(`${config.apiBaseUrl.replace(/\/$/, "")}/search`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("q", "");
  url.searchParams.set("tag", config.tag);
  url.searchParams.set("per_page", "50");
  url.searchParams.set("order", config.order);
  url.searchParams.set("scope", "songs");
  return url.toString();
}

async function fetchWithRetry(url: string, config: ISingImporterConfig, fetchFn: typeof fetch, delayFn: (ms: number) => Promise<void>): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxNetworkRetries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, config, fetchFn);
      if (response.status >= 500 && attempt < config.maxNetworkRetries) {
        await ensureRetryableServerError(response, url);
        await delayFn(config.delayMs * (attempt + 1));
        continue;
      }
      return response;
    } catch (error) {
      if (error instanceof ISingSafetyStopError) {
        throw error;
      }
      lastError = error;
      if (attempt >= config.maxNetworkRetries) {
        break;
      }
      await delayFn(config.delayMs * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Network error while fetching iSing");
}

async function ensureRetryableServerError(response: Response, url: string): Promise<void> {
  const text = await response.clone().text();
  validateRawResponseText(text, response.headers.get("content-type") ?? "", url);
}

async function fetchWithTimeout(url: string, config: ISingImporterConfig, fetchFn: typeof fetch): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);
  const headers: Record<string, string> = {
    accept: "application/json"
  };

  if (config.userAgent) {
    headers["user-agent"] = config.userAgent;
  }

  try {
    return await fetchFn(url, {
      headers,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function absolutizeUrl(nextUrl: string, apiBaseUrl: string): string {
  return new URL(nextUrl, `${apiBaseUrl.replace(/\/$/, "")}/`).toString();
}

function dedupeSongs(songs: LocalSong[]): LocalSong[] {
  const byKey = new Map<string, LocalSong>();
  for (const song of songs) {
    byKey.set(`${song.source}:${song.sourceSongId}`, song);
  }
  return Array.from(byKey.values());
}

function toImportStoppedError(error: unknown, url: string, report: ISingImportReport, finishedAt: string): ISingImportStoppedError {
  const reason = error instanceof ISingSafetyStopError ? error.reason : error instanceof Error ? error.message : "Unknown import error";
  const failedAtUrl = error instanceof ISingSafetyStopError ? error.url : url;
  const stoppedReport: ISingImportReport = {
    ...report,
    finishedAt,
    failedAtUrl,
    errors: [...report.errors, reason]
  };

  return new ISingImportStoppedError(reason, failedAtUrl, stoppedReport);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
