import { resolve } from "node:path";

import { config } from "dotenv";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { readKaraFunCsvRows } from "./karafun-csv.ts";
import {
  mapKaraFunRowToSong,
  type KaraFunSongPayload,
} from "./karafun-mapping.ts";
import { songs } from "./schema.ts";

const DEFAULT_INPUT_PATH = "data/sources/karafuncatalog.csv";
const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 1_000;

type ImportSummary = {
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
};

config({ path: [".env.local", ".env"], quiet: true });

const summary: ImportSummary = {
  processed: 0,
  inserted: 0,
  updated: 0,
  skipped: 0,
  errors: 0,
};

let client: ReturnType<typeof postgres> | null = null;

try {
  const options = parseOptions(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  client = postgres(databaseUrl, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: 1,
    prepare: false,
  });
  const db = drizzle({ client });
  const seenSourceSongIds = new Set<string>();
  let batch: KaraFunSongPayload[] = [];

  const persistBatch = async () => {
    if (batch.length === 0) {
      return;
    }

    const sourceSongIds = batch.map((song) => song.sourceSongId);
    const existingRows = await db
      .select({ sourceSongId: songs.sourceSongId })
      .from(songs)
      .where(
        and(
          eq(songs.source, "karafun"),
          inArray(songs.sourceSongId, sourceSongIds),
        ),
      );
    const existingIds = new Set(
      existingRows.flatMap((row) =>
        row.sourceSongId === null ? [] : [row.sourceSongId],
      ),
    );

    await db
      .insert(songs)
      .values(batch)
      .onConflictDoUpdate({
        target: [songs.source, songs.sourceSongId],
        targetWhere: sql.raw('"source_song_id" is not null'),
        set: {
          title: sql.raw('excluded."title"'),
          artist: sql.raw('excluded."artist"'),
          normalizedTitle: sql.raw('excluded."normalized_title"'),
          normalizedArtist: sql.raw('excluded."normalized_artist"'),
          searchText: sql.raw('excluded."search_text"'),
          genres: sql.raw('excluded."genres"'),
          languages: sql.raw('excluded."languages"'),
          isDuet: sql.raw('excluded."is_duet"'),
          isExplicit: sql.raw('excluded."is_explicit"'),
          lastSeenAt: sql.raw('excluded."last_seen_at"'),
          lastCheckedAt: sql.raw('excluded."last_checked_at"'),
          updatedAt: sql.raw('excluded."updated_at"'),
        },
      });

    summary.updated += existingIds.size;
    summary.inserted += batch.length - existingIds.size;
    batch = [];

    console.log(
      `KaraFun import progress: processed=${summary.processed} inserted=${summary.inserted} updated=${summary.updated} skipped=${summary.skipped} errors=${summary.errors}`,
    );
  };

  const checkedAt = new Date();

  for await (const row of readKaraFunCsvRows(options.inputPath)) {
    summary.processed += 1;

    const song = mapKaraFunRowToSong(row, checkedAt);
    if (song === null) {
      summary.skipped += 1;
      continue;
    }

    if (seenSourceSongIds.has(song.sourceSongId)) {
      summary.skipped += 1;
      continue;
    }

    seenSourceSongIds.add(song.sourceSongId);
    batch.push(song);

    if (batch.length >= options.batchSize) {
      await persistBatch();
    }
  }

  await persistBatch();
} catch (error) {
  summary.errors += 1;
  console.error(
    `KaraFun import failed: ${error instanceof Error ? error.message : "Unknown error"}`,
  );
  process.exitCode = 1;
} finally {
  if (client !== null) {
    await client.end({ timeout: 5 });
  }

  console.log("KaraFun import summary");
  console.log(`processed=${summary.processed}`);
  console.log(`inserted=${summary.inserted}`);
  console.log(`updated=${summary.updated}`);
  console.log(`skipped=${summary.skipped}`);
  console.log(`errors=${summary.errors}`);
}

function parseOptions(args: string[]) {
  let inputPath = DEFAULT_INPUT_PATH;
  let batchSize = DEFAULT_BATCH_SIZE;
  let positionalInputSeen = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--input") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--input requires a file path.");
      }
      inputPath = value;
      index += 1;
      continue;
    }

    if (argument === "--batch-size") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--batch-size requires a number.");
      }
      batchSize = parseBatchSize(value);
      index += 1;
      continue;
    }

    if (argument.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    }

    if (positionalInputSeen) {
      throw new Error(`Unexpected positional argument: ${argument}`);
    }

    inputPath = argument;
    positionalInputSeen = true;
  }

  return {
    inputPath: resolve(inputPath),
    batchSize,
  };
}

function parseBatchSize(value: string) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0 ||
    parsed > MAX_BATCH_SIZE
  ) {
    throw new Error(
      `--batch-size must be an integer between 1 and ${MAX_BATCH_SIZE}.`,
    );
  }

  return parsed;
}
