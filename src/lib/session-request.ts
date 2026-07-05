export const SESSION_REQUESTER_NAME_MIN_LENGTH = 2;
export const SESSION_REQUESTER_NAME_MAX_LENGTH = 40;

export function normalizeSessionRequesterName(value: string) {
  return value.trim();
}
