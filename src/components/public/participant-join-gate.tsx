"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import {
  isParticipantNicknameLengthValid,
  normalizeParticipantNickname,
  PARTICIPANT_NICKNAME_MAX_LENGTH,
} from "@/lib/participant-nickname";
import styles from "./public.module.css";
import { joinSession, SessionClientError } from "./session-api";

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

  return (
    <section className={`${styles.sessionJoinGradient} min-h-dvh overflow-hidden text-foreground`} aria-labelledby="participant-join-title">
      <div className="grid min-h-[53dvh] content-center justify-items-center gap-2 px-6 pt-[max(2rem,env(safe-area-inset-top))] pb-40 text-center">
        <Image
          alt="Poza Nutą"
          className="h-auto w-[min(12.5rem,42vw)] drop-shadow-[0_1rem_2rem_oklch(0_0_0_/_28%)]"
          height={1254}
          priority
          src="/brand/poza_nuta_logo-white.png"
          width={1254}
        />
        <p className="mt-3 text-sm font-bold tracking-[0.04em] uppercase">Dołączasz do karaoke</p>
        <h1 className="max-w-[22rem] text-[clamp(1.5rem,7vw,2.25rem)] font-extrabold leading-[1.08] tracking-[-0.045em]" id="participant-join-title">{eventName ?? "Sesja karaoke"}</h1>
      </div>

      <Drawer dismissible={false} open>
        <DrawerContent
          className="border-border bg-popover text-foreground"
          overlayClassName="!bg-black/10 !backdrop-blur-none"
        >
          <DrawerHeader className="px-6 pt-2 pb-0 text-center">
            <DrawerTitle className="text-xl font-extrabold tracking-[-0.035em]">Jak mamy Cię podpisać?</DrawerTitle>
          </DrawerHeader>
          <form className="grid gap-1.5 px-6 pt-1 pb-[calc(1.1rem+env(safe-area-inset-bottom))]" onSubmit={handleSubmit}>
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
            />
            <span className="text-right text-xs text-muted-foreground">
              {Array.from(displayName).length}/{PARTICIPANT_NICKNAME_MAX_LENGTH}
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
        </DrawerContent>
      </Drawer>
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
