import type { PublicQueueResponse } from "./api";

export const PUBLIC_QUEUE_BASE_POLL_INTERVAL_MS = 5_000;
export const PUBLIC_QUEUE_POLL_INTERVAL_MS = PUBLIC_QUEUE_BASE_POLL_INTERVAL_MS;
export const PUBLIC_QUEUE_MAX_POLL_INTERVAL_MS = 60_000;
export const PUBLIC_QUEUE_BACKOFF_JITTER_RATIO = 0.2;

export type PublicQueuePollingState = {
  failureCount: number;
  stopped: boolean;
};

export function createPublicQueuePollingState(): PublicQueuePollingState {
  return {
    failureCount: 0,
    stopped: false,
  };
}

export function recordPublicQueuePollSuccess(): PublicQueuePollingState {
  return createPublicQueuePollingState();
}

export function recordPublicQueuePollFailure(
  state: PublicQueuePollingState,
  status: number | null,
): PublicQueuePollingState {
  if (status === 404) {
    return {
      ...state,
      stopped: true,
    };
  }

  return {
    failureCount: state.failureCount + 1,
    stopped: false,
  };
}

export function shouldPollPublicQueue(
  queue: PublicQueueResponse | null,
  state: PublicQueuePollingState = createPublicQueuePollingState(),
) {
  if (state.stopped) {
    return false;
  }

  return queue === null || queue.enabled;
}

export function getPublicQueuePollDelayMs(
  state: PublicQueuePollingState,
  jitter = Math.random(),
) {
  if (state.failureCount <= 0) {
    return PUBLIC_QUEUE_BASE_POLL_INTERVAL_MS;
  }

  const backoffDelay = Math.min(
    PUBLIC_QUEUE_MAX_POLL_INTERVAL_MS,
    PUBLIC_QUEUE_BASE_POLL_INTERVAL_MS * 2 ** state.failureCount,
  );
  const jitterRatio = Math.max(0, Math.min(1, jitter));
  const jitterMs = Math.round(
    backoffDelay * PUBLIC_QUEUE_BACKOFF_JITTER_RATIO * jitterRatio,
  );

  return Math.min(PUBLIC_QUEUE_MAX_POLL_INTERVAL_MS, backoffDelay + jitterMs);
}
