import { MissingLocalSongIndexError, readLocalSongIndex } from "./localSongIndex.ts";
import { searchSongs } from "./songSearch.ts";

const query = process.argv.slice(2).join(" ").trim();

if (!query) {
  console.error('Usage: pnpm search:songs "krolowa lez"');
  process.exitCode = 1;
} else {
  try {
    const songs = await readLocalSongIndex();
    const results = searchSongs(query, songs, { limit: 10, source: "all" });

    console.log(`Search query: ${query}`);
    console.log("");

    if (results.length === 0) {
      console.log("No local matches found.");
    } else {
      for (const [index, result] of results.entries()) {
        console.log(`${index + 1}. ${result.song.artist} - ${result.song.title}`);
        console.log(`   Source: ${formatSource(result.song.source)}`);
        console.log(`   Score: ${result.score}`);
        if (result.song.sourceUrl) {
          console.log(`   URL: ${result.song.sourceUrl}`);
        }
        console.log("");
      }
    }
  } catch (error) {
    if (error instanceof MissingLocalSongIndexError) {
      console.error(`Missing local song index: ${error.path}`);
      console.error("Run: pnpm import:ising and/or pnpm import:karafun");
      process.exitCode = 1;
    } else if (error instanceof Error) {
      console.error(`Search failed: ${error.message}`);
      process.exitCode = 1;
    } else {
      console.error("Search failed: Unknown error");
      process.exitCode = 1;
    }
  }
}

function formatSource(source: string): string {
  return source === "ising" ? "iSing" : source === "karafun" ? "KaraFun" : source;
}
