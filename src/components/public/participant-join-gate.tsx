"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getParticipantNicknameLength,
  isParticipantNicknameLengthValid,
  normalizeParticipantNickname,
  PARTICIPANT_NICKNAME_MAX_LENGTH,
} from "@/lib/participant-nickname";
import { joinSession, SessionClientError } from "./session-api";
import { PublicSessionEntryShell } from "./public-session-entry-shell";

export function ParticipantJoinGate({
  sessionToken,
  eventName,
}: {
  sessionToken: string;
  eventName?: string;
}) {
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

  const normalizedLength = getParticipantNicknameLength(
    normalizeParticipantNickname(displayName).displayName,
  );

  return (
    <PublicSessionEntryShell eyebrow="Dołączasz do karaoke" title={eventName ?? "Sesja karaoke"} titleId="participant-join-title">
      <div className="px-6 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-8 sm:py-7">
        <h2 className="text-center text-xl font-extrabold tracking-[-0.03em] sm:text-2xl">Jak mamy Cię podpisać?</h2>
        <p className="mt-1.5 mb-5 text-center text-sm text-muted-foreground">Ta nazwa będzie widoczna w kolejce wydarzenia.</p>
          <form className="grid gap-1.5" onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor="participant-display-name">
              Imię lub ksywka
            </label>
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
              className="h-[3.2rem] border-border bg-secondary text-base"
              placeholder="Twój nick"
              style={{ fontSize: "1rem" }}
            />
            <span className="text-right text-xs text-muted-foreground">
              {normalizedLength}/{PARTICIPANT_NICKNAME_MAX_LENGTH}
            </span>
            {error ? (
              <p className="text-sm text-destructive" id="participant-display-name-error" role="alert">
                {error}
              </p>
            ) : null}
            <Button className="mt-1 h-12 rounded-full font-extrabold" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Dołączam…" : "Dołącz"}
            </Button>
          </form>
      </div>
    </PublicSessionEntryShell>
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
