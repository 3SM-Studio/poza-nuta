import { readFile } from "node:fs/promises";
import { upsertLocalSongs, writeImportReport } from "../ising/persistence.ts";
import type { LocalSong } from "../../songs/types.ts";
import { mapKaraFunSong } from "./mapKaraFunSong.ts";
import type { KaraFunCsvRow, KaraFunImporterConfig, KaraFunImportReport } from "./types.ts";

type ImportDependencies = {
  nowFn?: () => Date;
  persistFn?: (outputPath: string, songs: LocalSong[]) => Promise<{ importedCount: number; skippedCount: number }>;
  writeReportFn?: (outputPath: string, report: KaraFunImportReport) => Promise<void>;
};

const REQUIRED_HEADERS = ["Id", "Title", "Artist", "Year", "Duo", "Explicit", "Date Added", "Styles", "Languages"] as const;

export async function importKaraFunCsv(config: KaraFunImporterConfig, dependencies: ImportDependencies = {}): Promise<KaraFunImportReport> {
  const nowFn = dependencies.nowFn ?? (() => new Date());
  const persistFn = dependencies.persistFn ?? upsertLocalSongs;
  const writeReportFn = dependencies.writeReportFn ?? ((outputPath: string, nextReport: KaraFunImportReport) => writeImportReport(outputPath, nextReport));
  const startedAt = nowFn().toISOString();
  const report: KaraFunImportReport = {
    totalRows: 0,
    importedCount: 0,
    skippedCount: 0,
    startedAt,
    finishedAt: null,
    errors: []
  };

  try {
    const csvText = stripBom(await readFile(config.inputCsvPath, "utf8"));
    const rows = parseKaraFunCsv(csvText);
    const checkedAt = nowFn().toISOString();
    const songs: LocalSong[] = [];

    report.totalRows = rows.length;
    for (const row of rows) {
      const song = mapKaraFunSong(row, checkedAt);
      if (song) {
        songs.push(song);
      } else {
        report.skippedCount += 1;
      }
    }

    const persistenceResult = await persistFn(config.outputSongsPath, dedupeSongs(songs));
    report.importedCount = persistenceResult.importedCount;
    report.skippedCount += persistenceResult.skippedCount;
    report.finishedAt = nowFn().toISOString();
    await writeReportFn(config.outputReportPath, report);
    return report;
  } catch (error) {
    report.finishedAt = nowFn().toISOString();
    report.errors.push(error instanceof Error ? error.message : "Unknown KaraFun import error");
    await writeReportFn(config.outputReportPath, report);
    throw error;
  }
}

export function parseKaraFunCsv(csvText: string): KaraFunCsvRow[] {
  const records = parseDelimited(csvText, ";").filter((record) => record.some((field) => field.trim()));
  if (records.length === 0) {
    throw new Error("KaraFun CSV is empty");
  }

  const headers = records[0].map((header) => header.trim());
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw new Error(`KaraFun CSV is missing required columns: ${missingHeaders.join(", ")}`);
  }

  return records.slice(1).map((record) => {
    const row: Record<string, string> = {};
    for (const [index, header] of headers.entries()) {
      row[header] = record[index] ?? "";
    }
    return row as KaraFunCsvRow;
  });
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        field += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      record.push(field);
      field = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (inQuotes) {
    throw new Error("KaraFun CSV has an unterminated quoted field");
  }

  if (field || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  return records;
}

function dedupeSongs(songs: LocalSong[]): LocalSong[] {
  const byKey = new Map<string, LocalSong>();
  for (const song of songs) {
    byKey.set(`${song.source}:${song.sourceSongId}`, song);
  }
  return Array.from(byKey.values());
}

function stripBom(value: string): string {
  return value.replace(/^\uFEFF/, "");
}
