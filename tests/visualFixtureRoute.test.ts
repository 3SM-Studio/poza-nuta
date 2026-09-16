import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the public session visual fixture is dynamic and production-gated", () => {
  const source = readFileSync(
    "src/app/visual-fixture/public-session/page.tsx",
    "utf8",
  );

  assert.match(source, /export const dynamic = "force-dynamic"/);
  assert.match(source, /process\.env\.NODE_ENV === "production"/);
  assert.match(source, /process\.env\.POZA_NUTA_VISUAL_FIXTURE !== "1"/);
  assert.match(source, /notFound\(\)/);
  assert.match(source, /"pre-join"/);
  assert.match(source, /"discovery"/);
  assert.match(source, /"discovery-loading"/);
  assert.match(source, /"discovery-minimal"/);
  assert.match(source, /"discovery-network"/);
  assert.match(source, /"category-genre-results"/);
  assert.match(source, /"profile"/);
  assert.match(source, /"queue"/);
  assert.match(source, /"queue-current"/);
  assert.match(source, /"queue-mobile-collapsed"/);
  assert.match(source, /"queue-mobile-expanded"/);
  assert.match(source, /"queue-mobile-long"/);
  assert.match(source, /"queue-mobile-empty"/);
  assert.match(source, /"queue-desktop"/);
  assert.match(source, /"queue-desktop-long"/);
  assert.match(source, /"queue-desktop-empty"/);
  assert.match(source, /"search-results"/);
  assert.match(source, /"search-loading"/);
  assert.match(source, /"search-empty"/);
  assert.match(source, /"song-details"/);
  assert.match(source, /"song-details-submitting"/);
  assert.match(source, /"song-details-error"/);
  assert.match(source, /"artwork-gallery"/);
  assert.match(source, /"song-details-loading"/);
});
