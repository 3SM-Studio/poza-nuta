import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { importKaraFunCsv, parseKaraFunCsv } from "../src/importers/karafun/importKaraFunCsv.ts";
import { mapKaraFunSong } from "../src/importers/karafun/mapKaraFunSong.ts";
import type { LocalSong } from "../src/songs/types.ts";

test("parseKaraFunCsv reads semicolon-delimited quoted rows", () => {
  const rows = parseKaraFunCsv(
    [
      'Id;Title;Artist;Year;Duo;Explicit;"Date Added";Styles;Languages',
      '49375;"Tennessee Whiskey";"Chris Stapleton";2015;0;0;2015-07-21;Blues,Country,Soul,Rock;English',
      '56442;Shallow;"A Star is Born (2018 film)";2018;1;0;2018-10-15;Soundtrack,Pop,Duet;English'
    ].join("\n")
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].Title, "Tennessee Whiskey");
  assert.equal(rows[1].Artist, "A Star is Born (2018 film)");
});

test("mapKaraFunSong maps CSV metadata into the local song model", () => {
  const song = mapKaraFunSong(
    {
      Id: "56442",
      Title: "Shallow",
      Artist: "A Star is Born (2018 film)",
      Year: "2018",
      Duo: "1",
      Explicit: "0",
      "Date Added": "2018-10-15",
      Styles: "Soundtrack,Pop,Duet",
      Languages: "English"
    },
    "2026-06-07T12:00:00.000Z"
  );

  assert.ok(song);
  assert.equal(song.source, "karafun");
  assert.equal(song.sourceSongId, "56442");
  assert.equal(song.releaseYear, 2018);
  assert.equal(song.isDuet, true);
  assert.equal(song.isExplicit, false);
  assert.deepEqual(song.genres, ["Soundtrack", "Pop", "Duet"]);
  assert.deepEqual(song.languages, ["English"]);
  assert.equal(song.searchText, "a star is born 2018 film shallow 2018 soundtrack pop duet english duet duo");
});

test("importKaraFunCsv upserts KaraFun songs into the shared local index", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "karafun-import-"));
  try {
    const inputCsvPath = join(tempDir, "karafun.csv");
    const outputSongsPath = join(tempDir, "songs.json");
    const outputReportPath = join(tempDir, "karafun-import-report.json");
    const existingSong: LocalSong = {
      source: "ising",
      sourceSongId: "9053",
      title: "Krolowa Lez",
      subtitle: null,
      artist: "Agnieszka Chylinska",
      artistSourceId: null,
      normalizedTitle: "krolowa lez",
      normalizedArtist: "agnieszka chylinska",
      searchText: "agnieszka chylinska krolowa lez",
      durationSeconds: null,
      genres: ["Pop"],
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

    await writeFile(
      inputCsvPath,
      [
        'Id;Title;Artist;Year;Duo;Explicit;"Date Added";Styles;Languages',
        "12543;Creep;Radiohead;1992;0;1;2008-03-07;Rock,Alternative;English"
      ].join("\n"),
      "utf8"
    );
    await writeFile(outputSongsPath, JSON.stringify([existingSong], null, 2), "utf8");

    const report = await importKaraFunCsv(
      {
        inputCsvPath,
        outputSongsPath,
        outputReportPath
      },
      {
        nowFn: () => new Date("2026-06-07T12:00:00.000Z")
      }
    );
    const output = JSON.parse(await readFile(outputSongsPath, "utf8")) as LocalSong[];

    assert.equal(report.totalRows, 1);
    assert.equal(report.importedCount, 1);
    assert.equal(output.length, 2);
    assert.equal(output.some((song) => song.source === "ising"), true);
    assert.equal(output.some((song) => song.source === "karafun" && song.sourceSongId === "12543"), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
