"use client";

import { CircleAlert, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PublicSessionEntryShell } from "./public-session-entry-shell";
import { resolveJoinCodeClient, type JoinCodeResolution } from "./join-code-api";
import { SessionCodeForm } from "./session-code-form";

export type JoinCodeError = "invalid" | "rate-limited" | "unavailable";

export function JoinCodeGate({ joinError, resolveCode = resolveJoinCodeClient }: {
  joinError?: string;
  resolveCode?: (code: string, signal?: AbortSignal) => Promise<JoinCodeResolution>;
}) {
  const router = useRouter();
  const [activeError, setActiveError] = useState<JoinCodeError | null>(normalizeJoinError(joinError));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function continueToCode(code: string) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setActiveError(null);
    setIsSubmitting(true);

    try {
      const result = await resolveCode(code, controller.signal);
      if (controller.signal.aborted) return;
      if (result.status === "resolved") {
        router.push(result.location);
        return;
      }
      setActiveError(result.error);
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) return;
      setActiveError("unavailable");
    } finally {
      if (!controller.signal.aborted) setIsSubmitting(false);
    }
  }

  return (
    <PublicSessionEntryShell eyebrow="Dołącz do karaoke" title="Wpisz kod wydarzenia" titleId="join-code-title">
      <div className="px-6 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-8 sm:py-7">
        <h2 className="text-center text-xl font-extrabold tracking-[-0.03em] sm:text-2xl">Kod wydarzenia</h2>
        <p className="mt-1.5 mb-5 text-center text-sm text-muted-foreground">Kod znajdziesz na ekranie lub przy stoliku.</p>
        <SessionCodeForm
          externalErrorId={activeError ? "session-code-resolution-error" : undefined}
          isSubmitting={isSubmitting}
          onCodeChange={() => setActiveError(null)}
          onSubmitCode={continueToCode}
        />
        {activeError ? <JoinErrorAlert kind={activeError} /> : null}
      </div>
    </PublicSessionEntryShell>
  );
}

function normalizeJoinError(value?: string): JoinCodeError | null {
  return value === "invalid" || value === "rate-limited" || value === "unavailable" ? value : null;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function JoinErrorAlert({ kind }: { kind: JoinCodeError }) {
  const limited = kind === "rate-limited";
  const unavailable = kind === "unavailable";
  const Icon = limited ? ShieldAlert : CircleAlert;
  return (
    <Alert className="mt-4 text-left" id="session-code-resolution-error" variant={limited || unavailable ? "destructive" : "default"}>
      <Icon aria-hidden="true" />
      <AlertTitle>{limited ? "Zbyt wiele prób" : unavailable ? "Nie możemy teraz sprawdzić kodu" : "Nie znaleźliśmy aktywnego wydarzenia"}</AlertTitle>
      <AlertDescription>
        {limited ? "Odczekaj chwilę, a potem spróbuj ponownie." : unavailable ? "Kod pozostał wpisany. Spróbuj ponownie za chwilę." : "Sprawdź cyfry lub poproś organizatora o aktualny kod."}
      </AlertDescription>
    </Alert>
  );
}
