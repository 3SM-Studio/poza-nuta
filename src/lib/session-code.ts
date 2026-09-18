export const SESSION_CODE_LENGTH = 6;
export const SESSION_CODE_PATTERN = /^[0-9]{6}$/;

export function normalizeSessionCode(value: string) {
  return value.trim();
}

export function isCanonicalSessionCode(value: string) {
  return SESSION_CODE_PATTERN.test(value);
}
