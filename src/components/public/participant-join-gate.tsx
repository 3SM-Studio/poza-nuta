"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  isParticipantNicknameLengthValid,
  normalizeParticipantNickname,
  PARTICIPANT_NICKNAME_MAX_LENGTH,
} from "@/lib/participant-nickname";
import styles from "./public.module.css";
import { joinSession, SessionClientError } from "./session-api";

export function ParticipantJoinGate({ sessionToken }: { sessionToken: string }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nickname = normalizeParticipantNickname(displayName);

    if (!isParticipantNicknameLengthValid(nickname.displayName)) {
      setError("Ksywka musi mieć od 2 do 24 znaków.");
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      await joinSession(sessionToken, nickname.displayName);
      router.refresh();
    } catch (caughtError) {
      setError(getJoinErrorMessage(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className={styles.publicSection} aria-labelledby="participant-join-title">
      <h2 id="participant-join-title">Dołącz do sesji</h2>
      <p className={styles.inlineMessage}>
        Jak mamy Cię podpisać? Wybierz imię lub ksywkę używaną w kolejce tego
        wydarzenia.
      </p>
      <form className={styles.requestForm} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label htmlFor="participant-display-name">Imię lub ksywka</label>
          <Input
            id="participant-display-name"
            name="displayName"
            autoComplete="nickname"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setError(null);
            }}
            required
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "participant-display-name-error" : undefined}
            disabled={isSubmitting}
            autoFocus
          />
          <span className={styles.characterCount}>
            {Array.from(displayName).length}/{PARTICIPANT_NICKNAME_MAX_LENGTH}
          </span>
          {error ? (
            <p className={styles.fieldError} id="participant-display-name-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <Button className={styles.submitButton} type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Dołączam…" : "Dołącz do wydarzenia"}
        </Button>
      </form>
    </section>
  );
}

function getJoinErrorMessage(error: unknown) {
  if (error instanceof SessionClientError) {
    if (error.code === "SESSION_NICKNAME_TAKEN") {
      return "Ta ksywka jest już używana w tym wydarzeniu.";
    }
    if (error.status === 429) return "Zbyt wiele prób. Spróbuj ponownie za chwilę.";
    if (error.code === "SESSION_EVENT_NOT_STARTED") {
      return "Wydarzenie jeszcze się nie rozpoczęło.";
    }
    if (error.code === "SESSION_EVENT_CLOSED") {
      return "To wydarzenie jest już zamknięte.";
    }
  }
  return "Nie udało się dołączyć. Spróbuj ponownie.";
}
