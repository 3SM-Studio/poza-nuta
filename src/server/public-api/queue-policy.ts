export const PUBLIC_QUEUE_VISIBLE_STATUSES = ["approved", "now"] as const;

export const ACTIVE_PUBLIC_REQUEST_STATUSES = [
  "pending",
  "approved",
  "now",
] as const;

export type PublicQueueVisibleStatus =
  (typeof PUBLIC_QUEUE_VISIBLE_STATUSES)[number];

export function isPublicQueueVisibleStatus(
  status: string,
): status is PublicQueueVisibleStatus {
  return PUBLIC_QUEUE_VISIBLE_STATUSES.some(
    (visibleStatus) => visibleStatus === status,
  );
}

export function isActivePublicRequestStatus(
  status: string,
): status is (typeof ACTIVE_PUBLIC_REQUEST_STATUSES)[number] {
  return ACTIVE_PUBLIC_REQUEST_STATUSES.some(
    (activeStatus) => activeStatus === status,
  );
}
