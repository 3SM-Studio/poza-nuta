"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import {
  createPublicRequest,
  getPublicEvent,
  PublicClientError,
  type PublicEvent,
  type PublicSong,
  searchPublicSongs,
} from "./api";
import styles from "./public.module.css";
import {
  canSearchPublicSongs,
  formatSongSource,
  normalizePublicSearchTerm,
  PUBLIC_NOTE_MAX_LENGTH,
  PUBLIC_SINGER_NAME_MAX_LENGTH,
  type PublicRequestFormErrors,
  validatePublicRequestForm,
} from "./validation";

const REQUEST_SUCCESS_MESSAGE =
  "Dodano zgłoszenie. Operator musi je zatwierdzić.";

export function PublicRequestPage() {
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const [isEventLoading, setIsEventLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<PublicSong[]>([]);
  const [selectedSong, setSelectedSong] = useState<PublicSong | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [singerName, setSingerName] = useState("");
  const [note, setNote] = useState("");
  const [formErrors, setFormErrors] = useState<PublicRequestFormErrors>({});
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadEvent() {
      try {
        const activeEvent = await getPublicEvent();

        if (active) {
          setEvent(activeEvent);
        }
      } catch (caughtError) {
        if (active) {
          setEventError(
            caughtError instanceof PublicClientError &&
              caughtError.status === 404
              ? "Aktualnie nie ma aktywnego wydarzenia."
              : "Nie udało się wczytać aktywnego wydarzenia. Spróbuj ponownie później.",
          );
        }
      } finally {
        if (active) {
          setIsEventLoading(false);
        }
      }
    }

    void loadEvent();

    return () => {
      active = false;
    };
  }, []);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = normalizePublicSearchTerm(searchTerm);

    if (!canSearchPublicSongs(query)) {
      setSearchResults([]);
      setSearchMessage("Wpisz co najmniej 2 znaki.");
      return;
    }

    setIsSearching(true);
    setSearchMessage(null);
    setSubmitMessage(null);

    try {
      const songs = await searchPublicSongs(query);
      setSearchResults(songs);
      setSearchMessage(
        songs.length === 0 ? "Nie znaleziono pasujących piosenek." : null,
      );
    } catch {
      setSearchResults([]);
      setSearchMessage(
        "Nie udało się wyszukać piosenek. Spróbuj ponownie.",
      );
    } finally {
      setIsSearching(false);
    }
  }

  function selectSong(song: PublicSong) {
    setSelectedSong(song);
    setFormErrors((current) => ({ ...current, songId: undefined }));
    setSubmitMessage(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitMessage(null);

    const validation = validatePublicRequestForm({
      songId: selectedSong?.id ?? null,
      singerName,
      note,
    });

    if (!validation.success) {
      setFormErrors(validation.errors);
      return;
    }

    setFormErrors({});
    setIsSubmitting(true);

    try {
      await createPublicRequest(validation.data);
      setNote("");
      setSelectedSong(null);
      setSearchTerm("");
      setSearchResults([]);
      setSubmitMessage(REQUEST_SUCCESS_MESSAGE);
    } catch (caughtError) {
      setSubmitMessage(getSubmitErrorMessage(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.publicPage}>
      <div className={styles.publicShell}>
        <header className={styles.publicHeader}>
          <p className={styles.brand}>Poza Nutą</p>
          <h1>{event?.name ?? "Karaoke"}</h1>
          {event?.venue ? <p>{event.venue}</p> : null}
        </header>

        {isEventLoading ? (
          <div className={styles.statusMessage} role="status">
            Ładowanie wydarzenia…
          </div>
        ) : null}

        {eventError ? (
          <div className={styles.errorMessage} role="alert">
            {eventError}
          </div>
        ) : null}

        <section className={styles.publicSection}>
          <div className={styles.sectionHeading}>
            <h2>Wybierz piosenkę</h2>
            <Link href="/queue" className={styles.textLink}>
              Zobacz kolejkę
            </Link>
          </div>

          <form className={styles.searchForm} onSubmit={handleSearch}>
            <label className={styles.visuallyHidden} htmlFor="song-search">
              Tytuł lub wykonawca
            </label>
            <input
              id="song-search"
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Tytuł lub wykonawca"
              disabled={isSearching || isSubmitting || !event}
            />
            <button
              className={styles.primaryButton}
              type="submit"
              disabled={
                isSearching ||
                isSubmitting ||
                !event ||
                !canSearchPublicSongs(searchTerm)
              }
            >
              {isSearching ? "Szukam…" : "Szukaj"}
            </button>
          </form>

          {searchMessage ? (
            <p className={styles.inlineMessage} role="status">
              {searchMessage}
            </p>
          ) : null}

          {searchResults.length > 0 ? (
            <div className={styles.searchResults} aria-label="Wyniki wyszukiwania">
              {searchResults.map((song) => (
                <button
                  key={song.id}
                  className={`${styles.songResult} ${
                    selectedSong?.id === song.id ? styles.selectedResult : ""
                  }`}
                  type="button"
                  onClick={() => selectSong(song)}
                  aria-pressed={selectedSong?.id === song.id}
                  disabled={isSubmitting}
                >
                  <span className={styles.songResultTitle}>{song.title}</span>
                  <span className={styles.songResultArtist}>{song.artist}</span>
                  <span className={styles.songResultMeta}>
                    Źródło: {formatSongSource(song.source)} · Duet:{" "}
                    {song.isDuet ? "tak" : "nie"} · Explicit:{" "}
                    {song.isExplicit ? "tak" : "nie"} · Plus:{" "}
                    {song.isPlus ? "tak" : "nie"} · Hit:{" "}
                    {song.isHit ? "tak" : "nie"}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <section className={styles.publicSection}>
          <h2>Twoje zgłoszenie</h2>

          <div
            className={`${styles.selectedSong} ${
              formErrors.songId ? styles.invalidSelection : ""
            }`}
          >
            <span className={styles.fieldLabel}>Wybrana piosenka</span>
            {selectedSong ? (
              <>
                <strong>{selectedSong.title}</strong>
                <span>{selectedSong.artist}</span>
              </>
            ) : (
              <span>Najpierw wybierz wynik wyszukiwania.</span>
            )}
          </div>
          {formErrors.songId ? (
            <p className={styles.fieldError}>{formErrors.songId}</p>
          ) : null}

          <form className={styles.requestForm} onSubmit={handleSubmit}>
            <div className={styles.field}>
              <label htmlFor="singer-name">Jak masz na imię?</label>
              <input
                id="singer-name"
                type="text"
                value={singerName}
                onChange={(event) => {
                  setSingerName(event.target.value);
                  setFormErrors((current) => ({
                    ...current,
                    singerName: undefined,
                  }));
                }}
                maxLength={PUBLIC_SINGER_NAME_MAX_LENGTH}
                placeholder="Imię lub ksywka"
                disabled={isSubmitting || !event}
                required
              />
              <span className={styles.characterCount}>
                {singerName.length}/{PUBLIC_SINGER_NAME_MAX_LENGTH}
              </span>
              {formErrors.singerName ? (
                <p className={styles.fieldError}>{formErrors.singerName}</p>
              ) : null}
            </div>

            <div className={styles.field}>
              <label htmlFor="request-note">
                Notatka dla operatora (opcjonalnie)
              </label>
              <textarea
                id="request-note"
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  setFormErrors((current) => ({
                    ...current,
                    note: undefined,
                  }));
                }}
                maxLength={PUBLIC_NOTE_MAX_LENGTH}
                placeholder="Np. niższa tonacja"
                disabled={isSubmitting || !event}
                rows={3}
              />
              <span className={styles.characterCount}>
                {note.length}/{PUBLIC_NOTE_MAX_LENGTH}
              </span>
              {formErrors.note ? (
                <p className={styles.fieldError}>{formErrors.note}</p>
              ) : null}
            </div>

            <button
              className={`${styles.primaryButton} ${styles.submitButton}`}
              type="submit"
              disabled={isSubmitting || !event}
            >
              {isSubmitting ? "Dodaję…" : "Dodaj do kolejki"}
            </button>
          </form>

          {submitMessage ? (
            <div
              className={
                submitMessage === REQUEST_SUCCESS_MESSAGE
                  ? styles.successMessage
                  : styles.errorMessage
              }
              role={
                submitMessage === REQUEST_SUCCESS_MESSAGE ? "status" : "alert"
              }
            >
              {submitMessage}
            </div>
          ) : null}
        </section>

        <Link href="/queue" className={styles.queueLink}>
          Zobacz kolejkę
        </Link>
      </div>
    </main>
  );
}

function getSubmitErrorMessage(error: unknown) {
  if (error instanceof PublicClientError) {
    if (error.status === 400) {
      return "Sprawdź dane zgłoszenia i spróbuj ponownie.";
    }

    if (error.status === 404 && error.code === "SONG_NOT_FOUND") {
      return "Wybrana piosenka nie jest już dostępna. Wyszukaj ją ponownie.";
    }

    if (error.status === 404) {
      return "Brak aktywnego wydarzenia.";
    }
  }

  return "Nie udało się dodać zgłoszenia. Spróbuj ponownie.";
}
