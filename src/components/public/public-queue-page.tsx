"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { PublicQueueSkeleton } from "@/components/operator/dashboard-skeletons";
import type { QueueRealtimeConnectionStatus } from "@/lib/queue-realtime";

import {
  getPublicQueue,
  PublicClientError,
  type PublicQueueResponse,
} from "./api";
import styles from "./public.module.css";
import { usePublicQueueRealtime } from "./use-public-queue-realtime";

export function PublicQueuePage() {
  const [queue, setQueue] = useState<PublicQueueResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadQueue = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await getPublicQueue(signal);

        setQueue(response);
        setError(null);
      } catch (caughtError) {
        if (signal?.aborted || isAbortError(caughtError)) {
          return;
        }

        setError(getQueueErrorMessage(caughtError));
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );
  const liveStatus = usePublicQueueRealtime(
    queue?.enabled ? queue.eventId : null,
    async (_reason, signal) => loadQueue(signal),
  );
  const showInitialError = !isLoading && error && !queue;
  const showRefreshError = !isLoading && error && queue;

  useEffect(() => {
    const controller = new AbortController();

    async function initializeQueue() {
      await loadQueue(controller.signal);
    }

    void initializeQueue();

    return () => {
      controller.abort();
    };
  }, [loadQueue]);

  async function refreshQueue() {
    setIsRefreshing(true);
    setError(null);
    await loadQueue();
    setIsRefreshing(false);
  }

  return (
    <main className={styles.publicPage}>
      <div className={styles.queueShell}>
        <header className={styles.queueHeader}>
          <div>
            <Link
              className={styles.brand}
              href="/"
              aria-label="Przejdź na stronę główną"
            >
              <Image
                className={styles.brandLogo}
                src="/brand/poza_nuta_logo-white.png"
                alt="Poza Nutą"
                width={1254}
                height={1254}
              />
            </Link>
            <h1>Publiczna kolejka</h1>
            <span className={styles.inlineMessage} role="status">
              {formatLiveStatus(liveStatus)}
            </span>
          </div>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => void refreshQueue()}
            disabled={isLoading || isRefreshing}
          >
            {isRefreshing ? "Odświeżanie…" : "Odśwież"}
          </button>
        </header>

        <Link href="/" className={styles.backLink}>
          Wróć do zgłoszenia
        </Link>

        {isLoading ? <PublicQueueSkeleton /> : null}

        {showInitialError ? (
          <div className={styles.errorMessage} role="alert">
            {error}
          </div>
        ) : null}

        {showRefreshError ? (
          <div className={styles.errorMessage} role="alert">
            {error}
          </div>
        ) : null}

        {!isLoading && queue && !queue.enabled ? (
          <div className={styles.queueDisabled}>
            Publiczny podgląd kolejki jest teraz wyłączony.
          </div>
        ) : null}

        {!isLoading && queue?.enabled ? (
          queue.items.length > 0 ? (
            <div className={styles.publicQueueList}>
              {queue.items.map((item) => (
                <article
                  key={item.id}
                  className={`${styles.publicQueueItem} ${
                    item.status === "now" ? styles.nowItem : ""
                  }`}
                >
                  <div>
                    <span className={styles.queueStatus}>
                      {item.status === "now" ? "Teraz śpiewa" : "Następny"}
                    </span>
                    <h2>{item.singerName}</h2>
                    {queue.showSongTitles && item.title ? (
                      <p>
                        <strong>{item.title}</strong>
                        {item.artist ? ` · ${item.artist}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <span className={styles.queuePosition}>
                    {item.status === "now" ? "Teraz" : `#${item.position}`}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.queueDisabled}>
              Kolejka jest teraz pusta.
            </div>
          )
        ) : null}
      </div>
    </main>
  );
}

function getQueueErrorMessage(error: unknown) {
  if (error instanceof PublicClientError && error.status === 404) {
    return "Aktualnie nie ma aktywnego wydarzenia.";
  }

  if (error instanceof PublicClientError && error.status === 503) {
    return "Serwer jest chwilowo niedostępny. Spróbuj ponownie za chwilę.";
  }

  return "Nie udało się wczytać kolejki. Spróbuj ponownie.";
}

function formatLiveStatus(status: QueueRealtimeConnectionStatus) {
  switch (status) {
    case "live":
      return "Połączenie live";
    case "unavailable":
      return "Live niedostępne";
    default:
      return "Łączenie live…";
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
