import type { PublicQueueResponse } from "./api";

export const PUBLIC_QUEUE_POLL_INTERVAL_MS = 5_000;

export function shouldPollPublicQueue(queue: PublicQueueResponse | null) {
  return queue === null || queue.enabled;
}
