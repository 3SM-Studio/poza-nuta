import { stat } from "node:fs/promises";
import { MissingLocalSongIndexError, readLocalSongIndex } from "./localSongIndex.ts";
import type { LocalSong } from "../songs/types.ts";

type FileStat = {
  mtimeMs: number;
  size: number;
};

type Dependencies = {
  statFn?: (path: string) => Promise<FileStat>;
  readIndexFn?: (path: string) => Promise<LocalSong[]>;
};

export type LocalSongIndexCache = {
  getSongs: () => Promise<LocalSong[]>;
  reload: () => Promise<LocalSong[]>;
};

export function createLocalSongIndexCache(path: string, dependencies: Dependencies = {}): LocalSongIndexCache {
  const statFn = dependencies.statFn ?? stat;
  const readIndexFn = dependencies.readIndexFn ?? readLocalSongIndex;
  let loaded: { signature: string; songs: LocalSong[] } | null = null;
  let pending: Promise<LocalSong[]> | null = null;

  async function load(force: boolean): Promise<LocalSong[]> {
    if (pending) {
      return pending;
    }

    pending = (async () => {
      const fileStat = await statIndex(path, statFn);
      const signature = `${fileStat.mtimeMs}:${fileStat.size}`;

      if (!force && loaded?.signature === signature) {
        return loaded.songs;
      }

      const songs = await readIndexFn(path);
      loaded = { signature, songs };
      return songs;
    })();

    try {
      return await pending;
    } finally {
      pending = null;
    }
  }

  return {
    getSongs: () => load(false),
    reload: () => load(true)
  };
}

async function statIndex(path: string, statFn: (path: string) => Promise<FileStat>): Promise<FileStat> {
  try {
    return await statFn(path);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new MissingLocalSongIndexError(path);
    }
    throw error;
  }
}
