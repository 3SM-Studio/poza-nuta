import assert from "node:assert/strict";
import test from "node:test";

import {
  type KaraFunCsvRow,
  parseDelimitedRecord,
} from "../db/karafun-csv.ts";
import {
  mapKaraFunRowToSong,
  normalizeSongSearchText,
} from "../db/karafun-mapping.ts";

const row: KaraFunCsvRow = {
  Id: " 56442 ",
  Title: " Shallow ",
  Artist: " A Star is Born (2018 film) ",
  Year: "2018",
  Duo: "1",
  Explicit: "0",
  "Date Added": "2018-10-15",
  Styles: "Soundtrack, Pop, Duet",
  Languages: "English, Polish",
};

test("mapKaraFunRowToSong creates a complete songs insert payload", () => {
  const checkedAt = new Date("2026-07-02T12:00:00.000Z");
  const song = mapKaraFunRowToSong(row, checkedAt);

  assert.deepEqual(song, {
    source: "karafun",
    sourceSongId: "56442",
    title: "Shallow",
    artist: "A Star is Born (2018 film)",
    normalizedTitle: "shallow",
    normalizedArtist: "a star is born 2018 film",
    searchText:
      "a star is born 2018 film shallow 2018 soundtrack pop duet english polish duet duo",
    durationSeconds: null,
    genres: ["Soundtrack", "Pop", "Duet"],
    languages: ["English", "Polish"],
    isDuet: true,
    isExplicit: false,
    isPlus: false,
    isHit: false,
    sourceUrl: null,
    lastSeenAt: checkedAt,
    lastCheckedAt: checkedAt,
    createdAt: checkedAt,
    updatedAt: checkedAt,
  });
});

test("mapKaraFunRowToSong skips rows without a stable KaraFun id", () => {
  assert.equal(mapKaraFunRowToSong({ ...row, Id: " " }), null);
});

test("normalizeSongSearchText handles Polish diacritics", () => {
  assert.equal(normalizeSongSearchText("Królowa Łez"), "krolowa lez");
});

test("parseDelimitedRecord handles quoted delimiters and escaped quotes", () => {
  assert.deepEqual(
    parseDelimitedRecord('1;"Title; Live";"Artist ""Alias"""'),
    ["1", "Title; Live", 'Artist "Alias"'],
  );
});
