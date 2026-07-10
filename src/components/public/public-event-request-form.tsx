"use client";

import { useState, type FormEvent } from "react";

import type { PublicSong } from "./api";
import { createPublicRequest, PublicClientError, searchPublicSongs } from "./api";
import styles from "./public.module.css";
import {
  canSearchPublicSongs,
  formatSongSource,
  normalizePublicSearchTerm,
  PUBLIC_NOTE_MAX_LENGTH,
  PUBLIC_SINGER_NAME_MAX_LENGTH,
  validatePublicRequestForm,
  type PublicRequestFormErrors,
} from "./validation";

const REQUEST_SUCCESS_MESSAGE =
  "Dodano zgloszenie. Operator musi je zatwierdzic.";

type PublicEventRequestFormProps = {
  eventName: string;
  eventSlug: string;
};

export function PublicEventRequestForm({
  eventName,
  eventSlug,
}: PublicEventRequestFormProps) {
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
        songs.length === 0 ? "Nie znaleziono pasujacych piosenek." : null,
      );
    } catch {
      setSearchResults([]);
      setSearchMessage("Nie udalo sie wyszukac piosenek. Sprobuj ponownie.");
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
      await createPublicRequest({
        eventSlug,
        ...validation.data,
      });
      setSelectedSong(null);
      setSearchTerm("");
      setSearchResults([]);
      setSingerName("");
      setNote("");
      setSubmitMessage(REQUEST_SUCCESS_MESSAGE);
    } catch (caughtError) {
      setSubmitMessage(getSubmitErrorMessage(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <section className={styles.publicSection}>
        <div className={styles.sectionHeading}>
          <h2>Wybierz piosenke</h2>
          <span className={styles.inlineMessage}>Wydarzenie: {eventName}</span>
        </div>

        <form className={styles.searchForm} onSubmit={handleSearch}>
          <label className={styles.visuallyHidden} htmlFor="event-song-search">
            Tytul lub wykonawca
          </label>
          <input
            id="event-song-search"
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Tytul lub wykonawca"
            disabled={isSearching || isSubmitting}
          />
          <button
            className={styles.primaryButton}
            type="submit"
            disabled={
              isSearching || isSubmitting || !canSearchPublicSongs(searchTerm)
            }
          >
            {isSearching ? "Szukam..." : "Szukaj"}
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
                  Zrodlo: {formatSongSource(song.source)} - Duet:{" "}
                  {song.isDuet ? "tak" : "nie"} - Explicit:{" "}
                  {song.isExplicit ? "tak" : "nie"} - Plus:{" "}
                  {song.isPlus ? "tak" : "nie"} - Hit:{" "}
                  {song.isHit ? "tak" : "nie"}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className={styles.publicSection}>
        <h2>Twoje zgloszenie</h2>

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
            <label htmlFor="event-singer-name">Imie lub ksywka</label>
            <input
              id="event-singer-name"
              type="text"
              required
              value={singerName}
              onChange={(event) => {
                setSingerName(event.target.value);
                setFormErrors((current) => ({
                  ...current,
                  singerName: undefined,
                }));
              }}
              maxLength={PUBLIC_SINGER_NAME_MAX_LENGTH}
              placeholder="Imie lub ksywka"
              disabled={isSubmitting}
            />
            <span className={styles.characterCount}>
              {singerName.length}/{PUBLIC_SINGER_NAME_MAX_LENGTH}
            </span>
            {formErrors.singerName ? (
              <p className={styles.fieldError}>{formErrors.singerName}</p>
            ) : null}
          </div>

          <div className={styles.field}>
            <label htmlFor="event-request-note">Notatka dla operatora</label>
            <textarea
              id="event-request-note"
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setFormErrors((current) => ({ ...current, note: undefined }));
              }}
              maxLength={PUBLIC_NOTE_MAX_LENGTH}
              rows={3}
              placeholder="Opcjonalnie"
              disabled={isSubmitting}
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
            disabled={isSubmitting}
          >
            {isSubmitting ? "Dodaje..." : "Dodaj do kolejki"}
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
    </>
  );
}

function getSubmitErrorMessage(error: unknown) {
  if (error instanceof PublicClientError) {
    if (error.status === 400) {
      return "Sprawdz dane zgloszenia i sprobuj ponownie.";
    }

    if (error.status === 404 && error.code === "SONG_NOT_FOUND") {
      return "Wybrana piosenka nie jest juz dostepna. Wyszukaj ja ponownie.";
    }

    if (error.code === "PUBLIC_REQUESTS_DISABLED") {
      return "Publiczne zgloszenia sa wylaczone.";
    }

    if (error.code === "PUBLIC_EVENT_NOT_LIVE") {
      return "Zgloszenia sa dostepne tylko w trakcie wydarzenia.";
    }

    if (error.code === "PUBLIC_EVENT_CANCELLED") {
      return "Zgloszenia dla tego wydarzenia sa zamkniete.";
    }
  }

  return "Nie udalo sie dodac zgloszenia. Sprobuj ponownie.";
}
