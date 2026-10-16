export const ACTIVE_PARTICIPANT_REQUEST_STATUSES = [
  "pending",
  "approved",
  "now",
] as const;

export const PARTICIPANT_ACTIVE_REQUEST_LIMIT = 2;

export function isActiveParticipantRequestStatus(
  status: string,
): status is (typeof ACTIVE_PARTICIPANT_REQUEST_STATUSES)[number] {
  return ACTIVE_PARTICIPANT_REQUEST_STATUSES.some((active) => active === status);
}

export function countActiveParticipantRequests(
  requests: readonly { status: string }[],
) {
  return requests.filter((request) => isActiveParticipantRequestStatus(request.status)).length;
}
