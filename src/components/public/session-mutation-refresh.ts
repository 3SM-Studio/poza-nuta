const mutationRealtimeGraceMs = 250;

type MutableRef<T> = { current: T };

export async function waitForMutationRealtimeOrFallback({
  onFallback,
  realtimeInvalidationVersionRef,
  realtimeInvalidationWaitersRef,
  versionBeforeMutation,
}: {
  onFallback: (signal: AbortSignal) => Promise<void>;
  realtimeInvalidationVersionRef: MutableRef<number>;
  realtimeInvalidationWaitersRef: MutableRef<Set<() => void>>;
  versionBeforeMutation: number;
}) {
  if (realtimeInvalidationVersionRef.current !== versionBeforeMutation) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const controller = new AbortController();
    const finish = () => {
      if (settled) return;
      settled = true;
      controller.abort();
      window.clearTimeout(timer);
      realtimeInvalidationWaitersRef.current.delete(finish);
      resolve();
    };
    const timer = window.setTimeout(() => {
      void onFallback(controller.signal).finally(finish);
    }, mutationRealtimeGraceMs);

    realtimeInvalidationWaitersRef.current.add(finish);
    if (realtimeInvalidationVersionRef.current !== versionBeforeMutation) {
      finish();
    }
  });
}
