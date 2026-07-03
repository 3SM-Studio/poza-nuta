"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  getPublicQueue,
  PublicClientError,
  type PublicQueueResponse,
} from "./api";
import styles from "./public.module.css";

export function PublicQueuePage() {
  const [queue, setQueue] = useState<PublicQueueResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function initializeQueue() {
      try {
        const response = await getPublicQueue();

        if (active) {
          setQueue(response);
        }
      } catch (caughtError) {
        if (active) {
          setError(getQueueErrorMessage(caughtError));
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void initializeQueue();

    return () => {
      active = false;
    };
  }, []);

  async function refreshQueue() {
    setIsRefreshing(true);
    setError(null);

    try {
      setQueue(await getPublicQueue());
    } catch (caughtError) {
      setError(getQueueErrorMessage(caughtError));
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <main className={styles.publicPage}>
      <div className={styles.queueShell}>
        <header className={styles.queueHeader}>
          <div>
            <p className={styles.brand}>Poza Nutą</p>
            <h1>Publiczna kolejka</h1>
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

        {isLoading ? (
          <div className={styles.statusMessage} role="status">
            Ładowanie kolejki…
          </div>
        ) : null}

        {error ? (
          <div className={styles.errorMessage} role="alert">
            {error}
          </div>
        ) : null}

        {!isLoading && !error && queue && !queue.enabled ? (
          <div className={styles.queueDisabled}>
            Publiczny podgląd kolejki jest teraz wyłączony.
          </div>
        ) : null}

        {!isLoading && !error && queue?.enabled ? (
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
  return error instanceof PublicClientError && error.status === 404
    ? "Aktualnie nie ma aktywnego wydarzenia."
    : "Nie udało się wczytać kolejki. Spróbuj ponownie.";
}
