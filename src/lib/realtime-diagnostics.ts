type EventKind = 'connecting'|'subscribed'|'CHANNEL_ERROR'|'TIMED_OUT'|'CLOSED'|'auth_error'|'signed_out'|'account_changed'|'heartbeat_error'|'heartbeat_ok'|'offline'|'resume'|'snapshot_ok'|'snapshot_error'|'worker_started'|'worker_fallback'|'disposed';
type SdkFailure = 'authorization'|'timeout'|'network'|'unknown';
type Entry = { at: number; kind: EventKind; attempt: number; visible: boolean; online: boolean; cause?: SdkFailure };
const entries: Entry[] = [];
let enabled = false;
let tab = '';
let heartbeatAt = 0;
let snapshotAt = 0;
const counters = { subscriptions: 0, recoveries: 0, workers: 0, workerFallbacks: 0 };

// Opt-in, memory-only, 100 entries / 30 minutes. Never accepts SDK errors or payloads.
export function realtimeDiagnostic(kind: EventKind, attempt = 0, cause?: SdkFailure) {
  if (kind === 'connecting') counters.subscriptions++;
  if (kind === 'subscribed' && attempt) counters.recoveries++;
  if (kind === 'heartbeat_ok') heartbeatAt = Date.now();
  if (kind === 'snapshot_ok') snapshotAt = Date.now();
  if (kind === 'worker_started') counters.workers++;
  if (kind === 'worker_fallback') counters.workerFallbacks++;
  if (!enabled) return;
  entries.push({ at: Date.now(), kind, attempt, visible: document.visibilityState === 'visible', online: navigator.onLine, ...(cause ? {cause} : {}) });
  prune();
}
export function classifyRealtimeError(error: unknown): SdkFailure {
  const message = error instanceof Error ? error.message : '';
  if (/token|jwt|auth|permission|policy|forbidden/i.test(message)) return 'authorization';
  if (/timeout|timed out/i.test(message)) return 'timeout';
  if (/socket|network|connection|fetch/i.test(message)) return 'network';
  return 'unknown';
}
function prune() {
  while (entries.length && (entries.length > 100 || entries[0].at < Date.now() - 30 * 60_000)) entries.shift();
}
export function installRealtimeDiagnostics() {
  if (typeof window === 'undefined' || window.kunestuRealtimeDiagnostics) return;
  tab = crypto.randomUUID();
  window.kunestuRealtimeDiagnostics = {
    enable: () => { enabled = true; },
    disable: () => { enabled = false; entries.length = 0; },
    report: () => {
      prune();
      return { tab, enabled, heartbeatAgeMs: heartbeatAt ? Date.now() - heartbeatAt : null,
        snapshotAgeMs: snapshotAt ? Date.now() - snapshotAt : null, counters: { ...counters }, events: entries.map(e => ({ ...e })) };
    },
  };
}
declare global {
  interface Window {
    kunestuRealtimeDiagnostics?: {
      enable(): void;
      disable(): void;
      report(): { tab: string; enabled: boolean; heartbeatAgeMs: number|null; snapshotAgeMs: number|null;
        counters: typeof counters; events: Entry[] };
    };
  }
}
