import assert from "node:assert/strict";
import test from "node:test";
import { buildApiUrl, createApiClient, isSameSearchResult, validateSubmitRequest, type SearchResultDto } from "../apps/web/src/lib/apiClient.ts";

test("web API client builds URLs against the configured API base", () => {
  const url = buildApiUrl("http://127.0.0.1:4321", "/api/search", { q: "krolowa lez", limit: "10" });

  assert.equal(url, "http://127.0.0.1:4321/api/search?q=krolowa+lez&limit=10");
});

test("participant submit validation requires singerName", () => {
  assert.equal(validateSubmitRequest({ singerName: "", song: fixtureSong() }), "Podaj imię.");
});

test("participant submit validation requires selected song", () => {
  assert.equal(validateSubmitRequest({ singerName: "Michał", song: null }), "Wybierz piosenkę.");
});

test("web API client refuses iSing URLs", () => {
  assert.throws(() => createApiClient("https://api.ising.pl/v2"), /cannot use iSing URL/);
});

test("selected song comparison includes source and sourceSongId", () => {
  assert.equal(isSameSearchResult(fixtureSong({ source: "ising", sourceSongId: "123" }), fixtureSong({ source: "karafun", sourceSongId: "123" })), false);
  assert.equal(isSameSearchResult(fixtureSong({ source: "ising", sourceSongId: "123" }), fixtureSong({ source: "ising", sourceSongId: "123" })), true);
});

function fixtureSong(overrides: Partial<SearchResultDto> = {}): SearchResultDto {
  return {
    source: "ising",
    sourceSongId: "9053",
    title: "Królowa Łez",
    artist: "Agnieszka Chylińska",
    url: "https://ising.pl/agnieszka-chylinska-krolowa-lez-piosenka",
    score: 95,
    ...overrides
  };
}
