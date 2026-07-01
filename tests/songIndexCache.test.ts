import assert from "node:assert/strict";
import test from "node:test";
import { createLocalSongIndexCache } from "../src/search/cachedLocalSongIndex.ts";
import type { LocalSong } from "../src/songs/types.ts";

test("local song index cache does not reread unchanged index", async () => {
  let readCount = 0;
  const songs = [localSong("1", "First")];
  const cache = createLocalSongIndexCache("songs.json", {
    statFn: async () => ({ mtimeMs: 1, size: 100 }),
    readIndexFn: async () => {
      readCount += 1;
      return songs;
    }
  });

  assert.deepEqual(await cache.getSongs(), songs);
  assert.deepEqual(await cache.getSongs(), songs);
  assert.equal(readCount, 1);
});

test("local song index cache reloads when file signature changes", async () => {
  let readCount = 0;
  let mtimeMs = 1;
  const cache = createLocalSongIndexCache("songs.json", {
    statFn: async () => ({ mtimeMs, size: 100 }),
    readIndexFn: async () => {
      readCount += 1;
      return [localSong(String(readCount), `Song ${readCount}`)];
    }
  });

  assert.equal((await cache.getSongs())[0].title, "Song 1");
  mtimeMs = 2;
  assert.equal((await cache.getSongs())[0].title, "Song 2");
  assert.equal(readCount, 2);
});

function localSong(sourceSongId: string, title: string): LocalSong {
  return {
    source: "ising",
    sourceSongId,
    title,
    subtitle: null,
    artist: "Artist",
    artistSourceId: null,
    normalizedTitle: title.toLowerCase(),
    normalizedArtist: "artist",
    searchText: `artist ${title.toLowerCase()}`,
    durationSeconds: null,
    genres: [],
    isPlus: false,
    isHit: false,
    isBuyAvailable: false,
    sourceUrl: null,
    sourceSelflink: null,
    sourceDateAdded: null,
    availabilityStatus: "available",
    lastSeenAt: "2026-06-07T00:00:00.000Z",
    lastCheckedAt: "2026-06-07T00:00:00.000Z"
  };
}
