import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateAutoCloseAt,
  formatEventTimeRemaining,
  getLazyCloseDecision,
  shouldWarnEventClosingSoon,
} from "../src/lib/event-lifecycle.ts";
import {
  calculateDefaultDashboardEventAutoCloseAt,
  DEFAULT_DASHBOARD_EVENT_DURATION_HOURS,
  validateCreateDashboardEventInput,
  validateEventSettingsInput,
  validateExtendInput,
  validateStartEventInput,
} from "../src/server/operator-api/validation.ts";

test("calculateAutoCloseAt adds the default eight hours", () => {
  const startsAt = new Date("2026-07-02T18:00:00.000Z");

  assert.equal(
    calculateAutoCloseAt(startsAt).toISOString(),
    "2026-07-03T02:00:00.000Z",
  );
});

test("dashboard event create defaults close time to start plus six hours", () => {
  const startsAt = new Date("2026-07-05T18:00:00.000Z");
  const result = validateCreateDashboardEventInput({
    title: "Karaoke Night",
    startsAt,
    autoCloseAt: "",
    facebookUrl: "",
  });

  assert.equal(DEFAULT_DASHBOARD_EVENT_DURATION_HOURS, 6);
  assert.equal(
    calculateDefaultDashboardEventAutoCloseAt(startsAt).toISOString(),
    "2026-07-06T00:00:00.000Z",
  );
  assert.equal(result.success, true);
  assert.equal(
    result.success ? result.data.autoCloseAt.toISOString() : null,
    "2026-07-06T00:00:00.000Z",
  );
});

test("dashboard event create accepts a custom close time and Facebook URL", () => {
  const result = validateCreateDashboardEventInput({
    title: "Karaoke Night",
    startsAt: "2026-07-05T18:00:00.000Z",
    autoCloseAt: "2026-07-05T23:30:00.000Z",
    facebookUrl: "https://www.facebook.com/events/123",
  });

  assert.equal(result.success, true);
  assert.equal(
    result.success ? result.data.autoCloseAt.toISOString() : null,
    "2026-07-05T23:30:00.000Z",
  );
  assert.equal(
    result.success ? result.data.facebookUrl : null,
    "https://www.facebook.com/events/123",
  );
});

test("dashboard event create rejects close time before start", () => {
  const result = validateCreateDashboardEventInput({
    title: "Karaoke Night",
    startsAt: "2026-07-05T18:00:00.000Z",
    autoCloseAt: "2026-07-05T17:30:00.000Z",
  });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.success ? [] : result.issues.map((issue) => issue.field),
    ["autoCloseAt"],
  );
});

test("dashboard event create rejects invalid Facebook URL", () => {
  const result = validateCreateDashboardEventInput({
    title: "Karaoke Night",
    startsAt: "2026-07-05T18:00:00.000Z",
    facebookUrl: "not a url",
  });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.success ? [] : result.issues.map((issue) => issue.field),
    ["facebookUrl"],
  );
});

test("shouldWarnEventClosingSoon uses a thirty minute threshold", () => {
  const now = new Date("2026-07-02T18:00:00.000Z");

  assert.equal(
    shouldWarnEventClosingSoon("2026-07-02T18:30:00.000Z", now),
    true,
  );
  assert.equal(
    shouldWarnEventClosingSoon("2026-07-02T18:30:00.001Z", now),
    false,
  );
  assert.equal(
    shouldWarnEventClosingSoon("2026-07-02T17:59:59.999Z", now),
    false,
  );
  assert.equal(shouldWarnEventClosingSoon(null, now), false);
});

test("lazy close decision handles expired, future and missing deadlines", () => {
  const now = new Date("2026-07-02T18:00:00.000Z");

  assert.equal(
    getLazyCloseDecision(new Date("2026-07-02T17:59:59.999Z"), now),
    "expired",
  );
  assert.equal(
    getLazyCloseDecision(new Date("2026-07-02T18:00:00.000Z"), now),
    "expired",
  );
  assert.equal(
    getLazyCloseDecision(new Date("2026-07-02T18:00:00.001Z"), now),
    "not_expired",
  );
  assert.equal(getLazyCloseDecision(null, now), "no_deadline");
});

test("formatEventTimeRemaining reports hours, minutes and expired state", () => {
  const now = new Date("2026-07-02T18:00:00.000Z");

  assert.equal(
    formatEventTimeRemaining("2026-07-02T19:30:00.000Z", now),
    "1 godz. 30 min",
  );
  assert.equal(
    formatEventTimeRemaining("2026-07-02T18:20:00.000Z", now),
    "20 min",
  );
  assert.equal(
    formatEventTimeRemaining("2026-07-02T17:59:00.000Z", now),
    "Zamykanie",
  );
  assert.equal(formatEventTimeRemaining(null, now), "Brak terminu");
});

test("validateExtendInput accepts only one or two hours", () => {
  assert.deepEqual(validateExtendInput({ hours: 1 }), {
    success: true,
    data: { hours: 1 },
  });
  assert.deepEqual(validateExtendInput({ hours: 2 }), {
    success: true,
    data: { hours: 2 },
  });
  assert.equal(validateExtendInput({ hours: 0 }).success, false);
  assert.equal(validateExtendInput({ hours: 3 }).success, false);
  assert.equal(validateExtendInput({ hours: "1" }).success, false);
});

test("validateEventSettingsInput validates and normalizes all settings", () => {
  assert.deepEqual(
    validateEventSettingsInput({
      name: "  Poza Nutą  ",
      venue: "  Dom Kultury  ",
      publicQueueEnabled: true,
      publicShowSongTitles: false,
    }),
    {
      success: true,
      data: {
        name: "Poza Nutą",
        venue: "Dom Kultury",
        publicQueueEnabled: true,
        publicShowSongTitles: false,
      },
    },
  );

  const invalid = validateEventSettingsInput({
    name: "",
    venue: "x".repeat(121),
    publicQueueEnabled: "yes",
    publicShowSongTitles: null,
  });

  assert.equal(invalid.success, false);
  assert.deepEqual(
    invalid.success ? [] : invalid.issues.map((issue) => issue.field),
    ["name", "venue", "publicQueueEnabled", "publicShowSongTitles"],
  );
});

test("validateStartEventInput requires name and accepts an optional venue", () => {
  assert.deepEqual(
    validateStartEventInput({
      name: "  Nowy event  ",
      venue: "",
    }),
    {
      success: true,
      data: {
        name: "Nowy event",
        venue: null,
      },
    },
  );
  assert.equal(validateStartEventInput({ name: "" }).success, false);
  assert.equal(
    validateStartEventInput({
      name: "Event",
      venue: "x".repeat(121),
    }).success,
    false,
  );
});
