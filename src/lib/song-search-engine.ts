export function isUnicodeSongSearchEnabled(unicodeVersion = process.versions.unicode) {
  const engine = process.env.SONG_SEARCH_ENGINE ?? "legacy";
  if (engine !== "legacy" && engine !== "unicode-v2") throw new Error("Unrecognized song search engine.");
  if (engine === "unicode-v2" && unicodeVersion !== "17.0") throw new Error("Unicode search requires the verified Unicode 17 runtime.");
  return engine === "unicode-v2";
}
