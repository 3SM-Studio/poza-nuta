import type { createClient } from './supabase/client';
import type { QueueRealtimeConnectionStatus } from './queue-realtime';
import { classifyRealtimeError, installRealtimeDiagnostics, realtimeDiagnostic } from './realtime-diagnostics';

type Client = ReturnType<typeof createClient>;
type Listener = { state: (status: QueueRealtimeConnectionStatus) => void; message: (payload: unknown) => void; resume: () => void };
const clients = new WeakMap<Client, Transport>();
const removals = new WeakMap<Client, Map<string, Promise<unknown>>>();
const disconnects = new WeakMap<Client, Promise<unknown>>();
const STALE_MS = 65_000;
const RESUME_MS = 15_000;

function retire(client: Client, topic: string, channel: ReturnType<Client['channel']>) {
  let pending = removals.get(client);
  if (!pending) { pending = new Map(); removals.set(client, pending); }
  const result = Promise.resolve(pending.get(topic)).then(() => client.removeChannel(channel));
  pending.set(topic, result);
  // SDK resolves leave timeouts; still observe unexpected rejection without an
  // unhandled finally() promise. The active owner retries the same old channel.
  const cleanup = () => { if (pending.get(topic) === result) pending.delete(topic); };
  void result.then(cleanup, error => { realtimeDiagnostic('CHANNEL_ERROR', 0, classifyRealtimeError(error)); cleanup(); });
  return result;
}

/** One socket/heartbeat owner per browser SDK singleton, one channel per topic.
 * Separate documents have separate clients. No database reads, no queue polling.
 */
export function acquireRealtime(client: Client, topic: string, event: string, listener: Listener) {
  let transport = clients.get(client);
  if (!transport) { transport = new Transport(client); clients.set(client, transport); }
  return transport.acquire(topic, event, listener);
}

class Transport {
  private topics = new Map<string, Subscription>();
  private worker: Worker | undefined;
  private sentAt = 0;
  private okAt = Date.now();
  private heartbeatFailed = false;
  private resumedAt = 0;
  private pulseAt = Date.now();
  private suspended = false;
  private user: string | undefined;
  private auth: ReturnType<Client['auth']['onAuthStateChange']>['data']['subscription'];
  constructor(private client: Client) {
    installRealtimeDiagnostics();
    // The SDK still owns its socket reconnect/rejoin and default heartbeat timer.
    client.realtime.onHeartbeat(status => {
      if (status === 'sent') this.sentAt = Date.now();
      if (status === 'ok') { this.okAt = Date.now(); this.heartbeatFailed = false; realtimeDiagnostic('heartbeat_ok'); }
      if (status === 'error' || status === 'timeout' || status === 'disconnected') {
        this.heartbeatFailed = true;
        realtimeDiagnostic('heartbeat_error');
        this.topics.forEach(s => s.fail('heartbeat_error'));
      }
    });
    this.auth = client.auth.onAuthStateChange((event, session) => {
      // Do not await Auth APIs inside an Auth callback (SDK lock).
      if (event === 'SIGNED_OUT') {
        this.user = undefined;
        realtimeDiagnostic('signed_out'); this.resetAuthorization();
      } else if (session && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
        const changed = this.user !== undefined && this.user !== session.user.id;
        this.user = session.user.id;
        if (changed) { realtimeDiagnostic('account_changed'); this.resetAuthorization(); }
        // Account switch requires a new route/controller; never resume the old actor's queue.
        else if (!this.suspended) queueMicrotask(() => this.topics.forEach(s => s.wake()));
      }
    }).data.subscription;
    window.addEventListener('focus', this.resume);
    window.addEventListener('pageshow', this.resume);
    window.addEventListener('online', this.resume);
    window.addEventListener('offline', this.offline);
    document.addEventListener('visibilitychange', this.visibility);
    // SDK 2.110.0 worker:true disables the ordinary heartbeat; startup/CSP errors
    // can throw/disconnect without a timer fallback. A guarded worker supplements
    // that timer instead. onHeartbeat('sent') prevents duplicate heartbeats.
    try {
      if (typeof Worker !== 'undefined') {
        this.worker = new Worker('/realtime-heartbeat-worker.js');
        this.worker.onmessage = event => {
          if (this.suspended || event.data !== 'heartbeat') return;
          // Resume after a suspended JS task queue even if Windows/Chrome emit
          // no visibilitychange/focus event. This is not a periodic data read.
          if (Date.now() - this.pulseAt > STALE_MS) this.resume();
          this.pulseAt = Date.now();
          if (event.data === 'heartbeat' && Date.now() - this.sentAt >= client.realtime.heartbeatIntervalMs && client.realtime.isConnected()) {
            // Phoenix 0.4.4 schedules the next main-thread send after each ACK.
            // Cancel that send before supplementing it: two near-simultaneous
            // sends with a pending ACK would otherwise manufacture a timeout.
            clearTimeout(client.realtime.heartbeatTimer);
            void client.realtime.sendHeartbeat().catch(() => {
              realtimeDiagnostic('heartbeat_error'); this.topics.forEach(s => s.fail('heartbeat_error'));
            });
          }
        };
        this.worker.onerror = () => { this.worker?.terminate(); this.worker = undefined; realtimeDiagnostic('worker_fallback'); };
        this.worker.postMessage('start'); realtimeDiagnostic('worker_started');
      } else realtimeDiagnostic('worker_fallback');
    } catch { this.worker?.terminate(); this.worker = undefined; realtimeDiagnostic('worker_fallback'); }
  }
  private resetAuthorization() {
    // A participant-only document has its own HttpOnly participant identity and
    // may rejoin with fresh anonymous Auth. Never revive the old operator route.
    this.suspended = [...this.topics.keys()].some(topic => topic.startsWith('dashboard:'));
    this.topics.forEach(s => s.pause());
    if (!this.suspended) queueMicrotask(() => {
      if (!this.suspended) this.topics.forEach(s => s.wake());
    });
  }
  acquire(topic: string, event: string, listener: Listener) {
    let sub = this.topics.get(topic);
    if (!sub) {
      sub = new Subscription(this.client, topic, event, () => this.suspended, () => {
        // A server-confirmed private join proves liveness now, without claiming
        // a heartbeat ACK. Do not carry the previous socket's failure into focus.
        this.okAt = Date.now(); this.heartbeatFailed = false;
      });
      this.topics.set(topic, sub);
    }
    sub.listeners.add(listener); listener.state(sub.status);
    sub.wake();
    return () => {
      sub.listeners.delete(listener);
      if (!sub.listeners.size) { sub.dispose(); this.topics.delete(topic); }
      if (!this.topics.size) this.dispose();
    };
  }
  private visibility = () => { if (document.visibilityState === 'visible') this.resume(); };
  private offline = () => {
    realtimeDiagnostic('offline');
    // Stop Phoenix's independent socket reconnect timer as well as our joins.
    // All topics in this document are offline; other tabs use different clients.
    this.topics.forEach(s => s.pause());
    if (disconnects.has(this.client)) return;
    const pending = this.client.realtime.disconnect().catch(error => {
      realtimeDiagnostic('CHANNEL_ERROR', 0, classifyRealtimeError(error));
    });
    disconnects.set(this.client, pending);
    void pending.then(() => {
      if (disconnects.get(this.client) === pending) disconnects.delete(this.client);
      if (!this.suspended && navigator.onLine) this.resume();
    });
  };
  private resume = () => {
    if (this.suspended || !navigator.onLine) return;
    // Throttle snapshots, not recovery. A brief offline period can end inside
    // the focus cooldown; unavailable channels must still wake without F5.
    this.topics.forEach(s => s.wake());
    const stale = this.heartbeatFailed || Date.now() - this.okAt > STALE_MS;
    // Focus storms do not cause repeated snapshots or reset the recovery budget.
    if (Date.now() - this.resumedAt < RESUME_MS) return;
    this.resumedAt = Date.now(); realtimeDiagnostic('resume');
    if (stale) this.topics.forEach(s => s.fail('heartbeat_error'));
    else this.topics.forEach(s => s.listeners.forEach(l => l.resume()));
  };
  private dispose() {
    this.suspended = true;
    this.auth.unsubscribe(); this.worker?.terminate(); this.worker = undefined;
    this.client.realtime.onHeartbeat(() => undefined);
    window.removeEventListener('focus', this.resume); window.removeEventListener('pageshow', this.resume);
    window.removeEventListener('online', this.resume); window.removeEventListener('offline', this.offline);
    document.removeEventListener('visibilitychange', this.visibility);
    clients.delete(this.client); realtimeDiagnostic('disposed');
  }
}

class Subscription {
  listeners = new Set<Listener>();
  status: QueueRealtimeConnectionStatus = 'connecting';
  private channel: ReturnType<Client['channel']> | undefined;
  private generation = 0;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  private disposed = false;
  private liveSince = 0;
  constructor(private client: Client, private topic: string, private event: string, private suspended: () => boolean, private confirmed: () => void) {}
  private state(status: QueueRealtimeConnectionStatus) { this.status = status; this.listeners.forEach(l => l.state(status)); }
  wake() {
    if (this.disposed || this.suspended() || this.busy || this.timer || this.status === 'live') return;
    if (!navigator.onLine) { this.state('unavailable'); return; }
    void this.connect();
  }
  fail(reason: 'CHANNEL_ERROR'|'TIMED_OUT'|'CLOSED'|'auth_error'|'heartbeat_error'|'offline', error?: unknown) {
    if (this.disposed || this.suspended()) return;
    realtimeDiagnostic(reason, this.attempt, error ? classifyRealtimeError(error) : undefined);
    if (this.liveSince && Date.now() - this.liveSince > 30_000) this.attempt = 0;
    this.liveSince = 0;
    this.state(navigator.onLine && this.attempt < 4 ? 'recovering' : 'unavailable');
    if (this.timer) return;
    // Allow SDK's built-in rejoin to win; rebuild only if it fails to subscribe.
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.attempt++, 5)) * (0.8 + Math.random() * 0.4);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (navigator.onLine) void this.connect(); else this.state('unavailable');
    }, delay);
  }
  private async connect() {
    if (this.disposed || this.suspended() || this.busy) return;
    this.busy = true;
    const generation = ++this.generation;
    const current = () => !this.disposed && !this.suspended() && this.generation === generation;
    this.state(this.attempt ? 'recovering' : 'connecting');
    realtimeDiagnostic('connecting', this.attempt);
    const old = this.channel; this.channel = undefined;
    // Watchdog covers hung setAuth as well as a channel that never calls back.
    this.deadline = setTimeout(() => { if (current()) { this.generation++; this.busy = false; this.fail('TIMED_OUT'); } }, 12_000);
    try {
      await disconnects.get(this.client);
      if (!current()) return;
      if (old) {
        try { await retire(this.client, this.topic, old); }
        catch (error) { if (current()) this.channel = old; throw error; }
      }
      else await removals.get(this.client)?.get(this.topic);
      if (!current()) return;
      await this.client.realtime.setAuth();
      if (!current()) return;
      this.channel = this.client.channel(this.topic, { config: { private: true } })
        .on('broadcast', { event: this.event }, message => { if (current()) this.listeners.forEach(l => l.message(message.payload)); });
      this.channel.subscribe((status, error) => {
        if (!current()) return;
        if (status === 'SUBSCRIBED') {
          clearTimeout(this.timer); this.timer = undefined; clearTimeout(this.deadline);
          this.confirmed();
          this.busy = false; this.liveSince = Date.now(); this.state('live'); realtimeDiagnostic('subscribed', this.attempt);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(this.deadline); this.busy = false; this.fail(status, error);
        }
      });
    } catch (error) { if (current()) { clearTimeout(this.deadline); this.busy = false; this.fail('auth_error', error); } }
  }
  pause() {
    this.generation++; clearTimeout(this.timer); this.timer = undefined; clearTimeout(this.deadline); this.busy = false;
    const channel = this.channel; this.channel = undefined;
    if (channel) void retire(this.client, this.topic, channel);
    this.state('unavailable');
  }
  dispose() { this.disposed = true; this.pause(); }
}
