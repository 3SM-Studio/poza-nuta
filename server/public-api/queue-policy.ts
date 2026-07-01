export const PUBLIC_QUEUE_VISIBLE_STATUSES = ["approved", "now"] as const;

export type PublicQueueVisibleStatus =
  (typeof PUBLIC_QUEUE_VISIBLE_STATUSES)[number];

export function isPublicQueueVisibleStatus(
  status: string,
): status is PublicQueueVisibleStatus {
  return PUBLIC_QUEUE_VISIBLE_STATUSES.some(
    (visibleStatus) => visibleStatus === status,
  );
}
