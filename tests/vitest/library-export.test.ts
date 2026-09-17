import { Readable } from "node:stream";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { OperatorApiError } from "@/server/operator-api/errors";
import {
  libraryExportColumns,
  libraryExportMimeType,
  generateLibraryExport,
  removeLibraryExportFile,
  writeLibraryExportWorkbook,
  type LibraryExportSong,
} from "@/server/platform-admin/library-export";
import {
  createLibraryExportResponse,
  handleLibraryExportRequest,
  libraryExportPermission,
} from "@/server/platform-admin/library-export-http";

const exportedAt = new Date("2026-09-17T12:34:56.000Z");
const fixtureSongs: LibraryExportSong[] = [
  {
    publicId: "11111111-1111-4111-8111-111111111111",
    source: "karafun",
    sourceSongId: "kf-100",
    title: "=A formula-shaped title",
    artist: "Artist One",
    durationSeconds: 201,
    genres: ["Pop", "Dance"],
    languages: ["Polish"],
    isDuet: true,
    isExplicit: false,
    isPlus: false,
    isHit: true,
    sourceUrl: "https://example.test/kf-100",
    createdAt: new Date("2026-01-02T03:04:05.000Z"),
    updatedAt: new Date("2026-02-03T04:05:06.000Z"),
    lastSeenAt: new Date("2026-03-04T05:06:07.000Z"),
    lastCheckedAt: null,
  },
  {
    publicId: "22222222-2222-4222-8222-222222222222",
    source: "ising",
    sourceSongId: "200",
    title: "Second title",
    artist: "Artist Two",
    durationSeconds: null,
    genres: [],
    languages: ["English", "Polish"],
    isDuet: false,
    isExplicit: true,
    isPlus: true,
    isHit: false,
    sourceUrl: null,
    createdAt: "2026-04-05T06:07:08.000Z",
    updatedAt: "2026-05-06T07:08:09.000Z",
    lastSeenAt: null,
    lastCheckedAt: new Date("2026-06-07T08:09:10.000Z"),
  },
];

describe("library XLSX export", () => {
  it.each([
    [401, "AUTHENTICATION_REQUIRED", "A valid Supabase Auth session is required."],
    [403, "PLATFORM_ACCESS_DENIED", "Platform access is not permitted."],
  ] as const)(
    "rejects an unauthorized download with %i before generating a workbook",
    async (status, code, message) => {
      const generateExport = vi.fn();
      const response = await handleLibraryExportRequest({
        requireAccess: async (permission) => {
          expect(permission).toBe(libraryExportPermission);
          throw new OperatorApiError(status, code, message);
        },
        generateExport,
      });

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: { code, message },
      });
      expect(generateExport).not.toHaveBeenCalled();
    },
  );

  it("creates a usable workbook with exact portable song identities", async () => {
    const generated = await generateLibraryExport(
      { readSongBatches: () => batches([fixtureSongs.slice(0, 1), fixtureSongs.slice(1)]) },
      exportedAt,
    );
    try {
      expect(generated.filename).toBe("poza-nuta-library-2026-09-17.xlsx");

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(generated.path);
      expect(workbook.worksheets.map(({ name }) => name)).toEqual([
        "Songs",
        "Metadata",
      ]);

      const songs = workbook.getWorksheet("Songs");
      expect(songs).toBeDefined();
      const headers = (songs!.getRow(1).values as unknown[]).slice(1);
      expect(headers).toEqual(libraryExportColumns);
      expect(headers).not.toContain("id");
      expect(headers).not.toContain("internal_id");
      expect(songs!.rowCount).toBe(fixtureSongs.length + 1);
      expect(songs!.autoFilter).toEqual("A1:Q1");
      expect(songs!.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });

      const firstSong = songs!.getRow(2);
      expect(firstSong.getCell(1).value).toBe(fixtureSongs[0]!.publicId);
      expect(firstSong.getCell(2).value).toBe("karafun");
      expect(firstSong.getCell(3).value).toBe("kf-100");
      expect(firstSong.getCell(4).value).toBe("=A formula-shaped title");
      expect(firstSong.getCell(4).type).toBe(ExcelJS.ValueType.String);
      expect(firstSong.getCell(5).value).toBe("Artist One");
      expect(firstSong.getCell(7).value).toBe("Pop | Dance");
      expect(firstSong.getCell(9).value).toBe(true);
      expect(firstSong.getCell(14).value).toBe(
        "2026-01-02T03:04:05.000Z",
      );

      const portableIds = songs!.getColumn(1).values.slice(2);
      for (const fixture of fixtureSongs) {
        expect(portableIds.filter((value) => value === fixture.publicId)).toHaveLength(1);
      }

      const metadata = workbook.getWorksheet("Metadata");
      expect(metadata).toBeDefined();
      const metadataValues = new Map(
        metadata!.getRows(2, metadata!.rowCount - 1)!.map((row) => [
          row.getCell(1).value,
          row.getCell(2).value,
        ]),
      );
      expect(metadataValues.get("export_format_version")).toBe(
        "poza-nuta-library-xlsx/1",
      );
      expect(metadataValues.get("exported_at_utc")).toBe(exportedAt.toISOString());
      expect(metadataValues.get("songs_count")).toBe(fixtureSongs.length);
      expect(metadataValues.get("portable_identity_field")).toBe("public_id");
      expect(metadataValues.get("sources")).toBe("ising, karafun");
    } finally {
      await removeLibraryExportFile(generated.path);
    }
  });

  it("closes and removes the temporary file when workbook generation fails", async () => {
    const path = temporaryWorkbookPath();
    const failingBatches = async function* () {
      yield fixtureSongs.slice(0, 1);
      throw new Error("simulated batch failure");
    };

    await expect(generateLibraryExport(
      { readSongBatches: () => failingBatches() },
      exportedAt,
      { createTemporaryPath: () => path },
    )).rejects.toThrow("simulated batch failure");
    await expect(waitForFileRemoval(path)).resolves.toBeUndefined();
  });

  it("returns the XLSX download contract and stable filename", async () => {
    const path = temporaryWorkbookPath();
    await writeLibraryExportWorkbook({
      path,
      exportedAt,
      songBatches: batches([fixtureSongs]),
    });

    const response = await createLibraryExportResponse({
      path,
      filename: "poza-nuta-library-2026-09-17.xlsx",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(libraryExportMimeType);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="poza-nuta-library-2026-09-17.xlsx"',
    );
    expect(Number(response.headers.get("Content-Length"))).toBeGreaterThan(0);
    await expect(access(path)).resolves.toBeUndefined();
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
    await expect(waitForFileRemoval(path)).resolves.toBeUndefined();
  });

  it("removes the temporary file when the download body is cancelled", async () => {
    const path = temporaryWorkbookPath();
    await writeLibraryExportWorkbook({
      path,
      exportedAt,
      songBatches: batches([fixtureSongs]),
    });

    const response = await createLibraryExportResponse({
      path,
      filename: "poza-nuta-library-2026-09-17.xlsx",
    });

    await expect(access(path)).resolves.toBeUndefined();
    await response.body!.cancel();
    await expect(waitForFileRemoval(path)).resolves.toBeUndefined();
  });

  it("removes the temporary file after a stream read failure", async () => {
    const path = temporaryWorkbookPath();
    await writeFile(path, "temporary export");
    const response = await createLibraryExportResponse(
      { path, filename: "poza-nuta-library-2026-09-17.xlsx" },
      {
        openReadStream: () => new Readable({
          read() {
            this.destroy(new Error("simulated read failure"));
          },
        }),
      },
    );

    await expect(response.arrayBuffer()).rejects.toThrow("simulated read failure");
    await expect(waitForFileRemoval(path)).resolves.toBeUndefined();
  });

  it("closes the stream before cleanup when Response construction fails", async () => {
    const path = temporaryWorkbookPath();
    await writeFile(path, "temporary export");

    await expect(createLibraryExportResponse(
      { path, filename: "poza-nuta-library-2026-09-17.xlsx" },
      {
        createResponse: () => {
          throw new Error("simulated Response construction failure");
        },
      },
    )).rejects.toThrow("simulated Response construction failure");
    await expect(waitForFileRemoval(path)).resolves.toBeUndefined();
  });
});

async function* batches(values: LibraryExportSong[][]) {
  for (const value of values) yield value;
}

function temporaryWorkbookPath() {
  return join(tmpdir(), `poza-nuta-library-test-${randomUUID()}.xlsx`);
}

async function waitForFileRemoval(path: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await access(path);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Temporary workbook was not removed after streaming.");
}
