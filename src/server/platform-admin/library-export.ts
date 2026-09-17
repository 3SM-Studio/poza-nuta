import "server-only";

import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { finished } from "node:stream/promises";

import ExcelJS from "exceljs";

import type {
  LibraryExportDataSource,
  LibraryExportSong,
} from "./library-export-store";

export {
  createLibraryExportDataSource,
  type LibraryExportDataSource,
  type LibraryExportSong,
} from "./library-export-store";

const libraryExportFormat = "poza-nuta-library-xlsx/1";
const libraryExportBatchSize = 1_000;

export const libraryExportMimeType =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const libraryExportColumns = [
  "public_id",
  "source",
  "source_song_id",
  "title",
  "artist",
  "duration_seconds",
  "genres",
  "languages",
  "is_duet",
  "is_explicit",
  "is_plus",
  "is_hit",
  "source_url",
  "created_at",
  "updated_at",
  "last_seen_at",
  "last_checked_at",
] as const;

export type GeneratedLibraryExport = {
  path: string;
  filename: string;
};

export async function generateLibraryExport(
  dataSource: LibraryExportDataSource,
  exportedAt = new Date(),
  dependencies: { createTemporaryPath?: () => string } = {},
): Promise<GeneratedLibraryExport> {
  const filename = `poza-nuta-library-${formatUtcDate(exportedAt)}.xlsx`;
  const path = dependencies.createTemporaryPath?.() ??
    join(tmpdir(), `poza-nuta-library-${randomUUID()}.xlsx`);

  try {
    await writeLibraryExportWorkbook({
      path,
      exportedAt,
      songBatches: dataSource.readSongBatches(libraryExportBatchSize),
    });
  } catch (error) {
    await removeLibraryExportFile(path);
    throw error;
  }

  return { path, filename };
}

export async function writeLibraryExportWorkbook(input: {
  path: string;
  exportedAt: Date;
  songBatches: AsyncIterable<LibraryExportSong[]>;
}) {
  const output = createWriteStream(input.path);
  const outputCompletion = finished(output);
  void outputCompletion.catch(() => undefined);

  try {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: output,
      useStyles: true,
      useSharedStrings: false,
    });
    workbook.creator = "Poza Nutą";
    workbook.created = input.exportedAt;

    const worksheet = workbook.addWorksheet("Songs", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    worksheet.columns = [
      { header: "public_id", key: "publicId", width: 38 },
      { header: "source", key: "source", width: 12 },
      { header: "source_song_id", key: "sourceSongId", width: 20 },
      { header: "title", key: "title", width: 36 },
      { header: "artist", key: "artist", width: 32 },
      { header: "duration_seconds", key: "durationSeconds", width: 18 },
      { header: "genres", key: "genres", width: 28 },
      { header: "languages", key: "languages", width: 22 },
      { header: "is_duet", key: "isDuet", width: 12 },
      { header: "is_explicit", key: "isExplicit", width: 12 },
      { header: "is_plus", key: "isPlus", width: 12 },
      { header: "is_hit", key: "isHit", width: 12 },
      { header: "source_url", key: "sourceUrl", width: 44 },
      { header: "created_at", key: "createdAt", width: 26 },
      { header: "updated_at", key: "updatedAt", width: 26 },
      { header: "last_seen_at", key: "lastSeenAt", width: 26 },
      { header: "last_checked_at", key: "lastCheckedAt", width: 26 },
    ];
    styleHeaderRow(worksheet.getRow(1));
    worksheet.autoFilter = `A1:${columnLetter(libraryExportColumns.length)}1`;

    let writtenSongs = 0;
    const exportedSources = new Set<string>();
    for await (const batch of input.songBatches) {
      for (const song of batch) {
        exportedSources.add(song.source);
        worksheet.addRow({
          publicId: song.publicId ?? "",
          source: song.source,
          sourceSongId: song.sourceSongId ?? "",
          title: song.title,
          artist: song.artist,
          durationSeconds: song.durationSeconds,
          genres: song.genres.join(" | "),
          languages: song.languages.join(" | "),
          isDuet: song.isDuet,
          isExplicit: song.isExplicit,
          isPlus: song.isPlus,
          isHit: song.isHit,
          sourceUrl: song.sourceUrl ?? "",
          createdAt: toIsoDate(song.createdAt),
          updatedAt: toIsoDate(song.updatedAt),
          lastSeenAt: toIsoDate(song.lastSeenAt),
          lastCheckedAt: toIsoDate(song.lastCheckedAt),
        }).commit();
        writtenSongs++;
      }
    }
    worksheet.commit();

    const metadata = workbook.addWorksheet("Metadata", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    metadata.columns = [
      { header: "key", key: "key", width: 28 },
      { header: "value", key: "value", width: 48 },
    ];
    styleHeaderRow(metadata.getRow(1));
    metadata.autoFilter = "A1:B1";
    const metadataRows = [
      ["export_format_version", libraryExportFormat],
      ["exported_at_utc", input.exportedAt.toISOString()],
      ["songs_count", writtenSongs],
      ["portable_identity_field", "public_id"],
      ["sources", [...exportedSources].sort().join(", ")],
    ] as const;
    for (const [key, value] of metadataRows) {
      metadata.addRow({ key, value }).commit();
    }
    metadata.commit();

    await workbook.commit();
    await outputCompletion;
  } catch (error) {
    output.destroy();
    await outputCompletion.catch(() => undefined);
    throw error;
  }
}

export async function removeLibraryExportFile(path: string) {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F2937" },
  };
  row.alignment = { vertical: "middle" };
  row.commit();
}

function toIsoDate(value: Date | string | null) {
  if (value === null) return "";
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toISOString();
}

function formatUtcDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function columnLetter(columnNumber: number) {
  let value = columnNumber;
  let result = "";
  while (value > 0) {
    value--;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}
