"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { PublicQueueSkeleton } from "@/components/operator/dashboard-skeletons";

import {
  getPublicQueue,
  PublicClientError,
  type PublicQueueResponse,
} from "./api";
import {
  createPublicQueuePollingState,
  getPublicQueuePollDelayMs,
  recordPublicQueuePollFailure,
  recordPublicQueuePollSuccess,
  shouldPollPublicQueue,
} from "./public-queue-polling";
import styles from "./public.module.css";

export function PublicQueuePage() {
  const [queue, setQueue] = useState<PublicQueueResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollingState, setPollingState] = useState(
    createPublicQueuePollingState,
  );
  const shouldPoll = shouldPollPublicQueue(queue, pollingState);
  const showInitialError = !isLoading && error && !queue;
  const showRefreshError = !isLoading && error && queue;

  useEffect(() => {
    let active = true;

    async function initializeQueue() {
      try {
        const response = await getPublicQueue();

        if (active) {
          setQueue(response);
          setPollingState(recordPublicQueuePollSuccess());
        }
      } catch (caughtError) {
        if (active) {
          setPollingState((state) =>
            recordPublicQueuePollFailure(
              state,
              getPublicClientErrorStatus(caughtError),
            ),
          );
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

  useEffect(() => {
    if (!shouldPoll) {
      return;
    }

    let active = true;
    const timeoutId = window.setTimeout(() => {
      getPublicQueue()
        .then((response) => {
          if (active) {
            setQueue(response);
            setPollingState(recordPublicQueuePollSuccess());
            setError(null);
          }
        })
        .catch((caughtError) => {
          if (active) {
            setPollingState((state) =>
              recordPublicQueuePollFailure(
                state,
                getPublicClientErrorStatus(caughtError),
              ),
            );
            setError(getQueueErrorMessage(caughtError));
          }
        });
    }, getPublicQueuePollDelayMs(pollingState));

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [pollingState, shouldPoll]);

  async function refreshQueue() {
    setIsRefreshing(true);
    setError(null);
    setPollingState(createPublicQueuePollingState());

    try {
      setQueue(await getPublicQueue());
      setPollingState(recordPublicQueuePollSuccess());
    } catch (caughtError) {
      setPollingState((state) =>
        recordPublicQueuePollFailure(
          state,
          getPublicClientErrorStatus(caughtError),
        ),
      );
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

function getPublicClientErrorStatus(error: unknown) {
  return error instanceof PublicClientError ? error.status : null;
}

function getQueueErrorMessage(error: unknown) {
  if (error instanceof PublicClientError && error.status === 404) {
    return "Aktualnie nie ma aktywnego wydarzenia. Automatyczne odświeżanie zostało zatrzymane.";
  }

  if (error instanceof PublicClientError && error.status === 503) {
    return "Serwer jest chwilowo niedostępny. Spróbujemy ponownie za dłuższą chwilę.";
  }
  return error instanceof PublicClientError && error.status === 404
    ? "Aktualnie nie ma aktywnego wydarzenia."
    : "Nie udało się wczytać kolejki. Spróbuj ponownie.";
}
