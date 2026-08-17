import assert from "node:assert/strict";
import test from "node:test";

import {
  getParticipantNicknameLength,
  isParticipantNicknameLengthValid,
  normalizeParticipantNickname,
} from "../src/lib/participant-nickname.ts";
import {
  validateParticipantJoinInput,
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
