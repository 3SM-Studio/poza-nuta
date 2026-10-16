export const PUBLIC_QUEUE_VISIBLE_STATUSES = ["approved", "now"] as const;

export {
  ACTIVE_PARTICIPANT_REQUEST_STATUSES as ACTIVE_PUBLIC_REQUEST_STATUSES,
  isActiveParticipantRequestStatus as isActivePublicRequestStatus,
} from "../../lib/participant-request-policy.ts";

export type PublicQueueVisibleStatus =
  (typeof PUBLIC_QUEUE_VISIBLE_STATUSES)[number];

export function isPublicQueueVisibleStatus(
  status: string,
): status is PublicQueueVisibleStatus {
  return PUBLIC_QUEUE_VISIBLE_STATUSES.some(
    (visibleStatus) => visibleStatus === status,
  );
}
