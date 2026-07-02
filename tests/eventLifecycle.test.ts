import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateAutoCloseAt,
  getLazyCloseDecision,
  shouldWarnEventClosingSoon,
} from "../lib/event-lifecycle.ts";
import {
  validateEventSettingsInput,
  validateExtendInput,
  validateStartEventInput,
} from "../server/operator-api/validation.ts";

test("calculateAutoCloseAt adds the default eight hours", () => {
  const startsAt = new Date("2026-07-02T18:00:00.000Z");

  assert.equal(
    calculateAutoCloseAt(startsAt).toISOString(),
    "2026-07-03T02:00:00.000Z",
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
