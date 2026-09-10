import assert from "node:assert/strict";
import test from "node:test";

import {
  getParticipantNicknameLength,
  isParticipantNicknameLengthValid,
  normalizeParticipantNickname,
} from "../src/lib/participant-nickname.ts";
import {
  isPublicRequestId,
  validateParticipantJoinInput,
  validateParticipantRenameInput,
  validateParticipantSessionRequestInput,
} from "../src/server/session-api/validation.ts";

test("participant nickname normalization is Unicode-safe and preserves Polish letters", () => {
  assert.deepEqual(normalizeParticipantNickname("  MICHAŁ\t  Żółć  "), {
    displayName: "MICHAŁ Żółć",
    normalizedDisplayName: "michał żółć",
  });
  assert.equal(getParticipantNicknameLength("🎤A"), 2);
  assert.equal(isParticipantNicknameLengthValid("🎤A"), true);
  assert.equal(isParticipantNicknameLengthValid("A"), false);
  assert.equal(isParticipantNicknameLengthValid("A".repeat(25)), false);
});

test("rename reuses join normalization and public request ids must be UUIDs", () => {
  assert.deepEqual(validateParticipantRenameInput({ displayName: "  Ala   Ola " }), {
    success: true,
    data: { displayName: "Ala Ola", normalizedDisplayName: "ala ola" },
  });
  assert.equal(isPublicRequestId("c09f9509-0677-45cc-98b2-b6f3892035de"), true);
  assert.equal(isPublicRequestId("42"), false);
});

test("rename validation uses normalized Unicode code points for the 2-24 limit", () => {
  const cases = [
    { value: "A", success: false },
    { value: "AB", success: true },
    { value: "A".repeat(24), success: true },
    { value: "A".repeat(25), success: false },
    { value: "🎤".repeat(24), success: true },
    { value: "🎤".repeat(25), success: false },
    { value: "🎤", success: false },
  ] as const;

  for (const { value, success } of cases) {
    assert.equal(
      validateParticipantRenameInput({ displayName: value }).success,
      success,
      `${getParticipantNicknameLength(value)} Unicode code points`,
    );
  }

  assert.deepEqual(
    validateParticipantRenameInput({ displayName: "  Żo\u0301łć\t  A  " }),
    {
      success: true,
      data: { displayName: "Żółć A", normalizedDisplayName: "żółć a" },
    },
  );
});

test("join validation applies the shared 2-24 character rule after normalization", () => {
  assert.deepEqual(validateParticipantJoinInput({ displayName: "  Ala   Ola " }), {
    success: true,
    data: { displayName: "Ala Ola", normalizedDisplayName: "ala ola" },
  });
  assert.equal(validateParticipantJoinInput({ displayName: " " }).success, false);
  assert.equal(
    validateParticipantJoinInput({ displayName: "x".repeat(25) }).success,
    false,
  );
});

test("canonical participant request rejects client-supplied ownership fields", () => {
  assert.deepEqual(validateParticipantSessionRequestInput({ songId: 7 }), {
    success: true,
    data: { songId: 7 },
  });

  for (const field of [
    "requesterName",
    "singerName",
    "displayName",
    "participantId",
    "eventParticipantId",
    "eventId",
    "sessionId",
  ]) {
    const result = validateParticipantSessionRequestInput({
      songId: 7,
      [field]: "spoofed",
    });
    assert.equal(result.success, false, field);
  }
});
