import assert from "node:assert/strict";
import test from "node:test";

import {
  formatWarsawDateTimeLocal,
  parseWarsawDateTimeLocal,
} from "../src/lib/warsaw-time.ts";
import { validateCreateDashboardEventInput } from "../src/server/operator-api/validation.ts";

test("Warsaw datetime-local parsing handles winter UTC+1", () => {
  assert.equal(
    parseWarsawDateTimeLocal("2026-01-15T20:00")?.toISOString(),
    "2026-01-15T19:00:00.000Z",
  );
});

test("Warsaw datetime-local parsing handles summer UTC+2", () => {
  assert.equal(
    parseWarsawDateTimeLocal("2026-07-15T20:00")?.toISOString(),
    "2026-07-15T18:00:00.000Z",
  );
});

test("Warsaw datetime-local formatting returns Polish local wall time", () => {
  assert.equal(
    formatWarsawDateTimeLocal(new Date("2026-07-15T18:00:00.000Z")),
    "2026-07-15T20:00",
  );
});

test("dashboard event validation treats datetime-local inputs as Europe/Warsaw", () => {
  const result = validateCreateDashboardEventInput({
    title: "Karaoke",
    startsAt: "2026-07-15T20:00",
    autoCloseAt: "",
    facebookUrl: "",
    publicQueueEnabled: false,
    publicShowSongTitles: true,
    isActivePublicEvent: false,
  });

  assert.equal(result.success, true);

  if (!result.success) {
    return;
  }

  assert.equal(result.data.startsAt.toISOString(), "2026-07-15T18:00:00.000Z");
  assert.equal(
    result.data.autoCloseAt.toISOString(),
    "2026-07-16T00:00:00.000Z",
  );
});
