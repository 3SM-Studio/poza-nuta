import { readFile } from "node:fs/promises";
import type { LocalSong } from "../songs/types.ts";

export class MissingLocalSongIndexError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`Missing local song index: ${path}`);
    this.name = "MissingLocalSongIndexError";
    this.path = path;
  }
}

export async function readLocalSongIndex(path = "data/imports/songs.json"): Promise<LocalSong[]> {
  let raw: string;

  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new MissingLocalSongIndexError(path);
    }
    throw error;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid local song index: ${path}`);
  }

  return parsed as LocalSong[];
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
