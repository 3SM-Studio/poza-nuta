"use client";

import { useEffect } from "react";
import { PARTICIPANT_HEARTBEAT_MS } from "@/lib/participant-presence";

// Mounted in the persistent session layout: one lease per tab, independent of
// catalog navigation and song requests. IDs live only in this effect's memory.
export function ParticipantPresence({ sessionToken }: { sessionToken: string }) {
  useEffect(() => {
    const url = `/api/s/${encodeURIComponent(sessionToken)}/presence`;
    let id = crypto.randomUUID();
    let connected = false;
    let active = true;
    let terminal = false;
    let epoch = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: AbortController | undefined;

    function disconnect() {
      const body = JSON.stringify({ connectionId: id, action: "disconnect" });
      if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      else void fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
    }

    async function beat() {
      if (!active || terminal || pending || !navigator.onLine) return;
      const version = epoch;
      let nextDelay = PARTICIPANT_HEARTBEAT_MS;
      const controller = new AbortController();
      pending = controller;
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch(url, {
          method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ connectionId: id, action: connected ? "heartbeat" : "connect" }), signal: controller.signal,
        });
        if (version !== epoch || !active) return;
        if (response.ok) connected = true;
        else if (response.status === 409) { id = crypto.randomUUID(); connected = false; nextDelay = 100; }
        else if ([401, 403, 404].includes(response.status)) terminal = true;
        // Network/429/5xx retries keep the ID; connect and heartbeat are idempotent.
      } catch {
        // Connectivity is represented by server TTL, never a fabricated lease.
      } finally {
        clearTimeout(timeout);
        if (pending === controller) pending = undefined;
        if (active && !terminal && version === epoch) timer = setTimeout(() => void beat(), nextDelay);
      }
    }

    function resume() {
      if (!active || terminal) return;
      clearTimeout(timer);
      void beat();
    }
    function hide() {
      clearTimeout(timer); epoch += 1; pending?.abort(); pending = undefined;
      disconnect(); connected = false;
      id = crypto.randomUUID();
    }
    function show() { resume(); }
    function visibility() { if (document.visibilityState === "visible") resume(); }
    void beat();
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false; epoch += 1; clearTimeout(timer); pending?.abort(); disconnect();
      window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show);
      window.removeEventListener("online", resume); document.removeEventListener("visibilitychange", visibility);
    };
  }, [sessionToken]);
  return null;
}
