import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { LocalSong } from "../../songs/types.ts";

export async function upsertLocalSongs(outputPath: string, songs: LocalSong[]): Promise<{ importedCount: number; skippedCount: number }> {
  const existingSongs = await readExistingSongs(outputPath);
  const byKey = new Map<string, LocalSong>();

  for (const song of existingSongs) {
    byKey.set(songKey(song), song);
  }

  for (const song of songs) {
    byKey.set(songKey(song), song);
  }

  await writeJson(outputPath, Array.from(byKey.values()).sort(compareSongs));

  return {
    importedCount: songs.length,
    skippedCount: 0
  };
}

export async function writeImportReport(outputPath: string, report: unknown): Promise<void> {
  await writeJson(outputPath, report);
}

async function readExistingSongs(outputPath: string): Promise<LocalSong[]> {
  try {
    const raw = await readFile(outputPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LocalSong[]) : [];
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function songKey(song: LocalSong): string {
  return `${song.source}:${song.sourceSongId}`;
}

function compareSongs(a: LocalSong, b: LocalSong): number {
  return a.artist.localeCompare(b.artist, "pl") || a.title.localeCompare(b.title, "pl") || a.sourceSongId.localeCompare(b.sourceSongId);
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
