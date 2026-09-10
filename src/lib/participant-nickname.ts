export const PARTICIPANT_NICKNAME_MIN_LENGTH = 2;
export const PARTICIPANT_NICKNAME_MAX_LENGTH = 24;

export type ParticipantNickname = {
  displayName: string;
  normalizedDisplayName: string;
};

export function normalizeParticipantNickname(value: string): ParticipantNickname {
  const displayName = value
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ");

  return {
    displayName,
    normalizedDisplayName: displayName.toLocaleLowerCase("pl-PL"),
  };
}

export function getParticipantNicknameLength(value: string) {
  return Array.from(value).length;
}

export function isParticipantNicknameLengthValid(value: string) {
  const length = getParticipantNicknameLength(value);
  return (
    length >= PARTICIPANT_NICKNAME_MIN_LENGTH &&
    length <= PARTICIPANT_NICKNAME_MAX_LENGTH
  );
}
