"use client";

import QRCode from "qrcode";
import { useActionState, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import styles from "./operator.module.css";

export type EventShareActionState = {
  message: string | null;
  sessionUrl: string | null;
  success: boolean;
};

export type EventShareAction = (
  state: EventShareActionState,
  formData: FormData,
) => Promise<EventShareActionState>;

export type EventShareLinkSummary = {
  createdAt: string;
  lastUsedAt: string | null;
  useCount: number;
} | null;

const initialState: EventShareActionState = {
  message: null,
  sessionUrl: null,
  success: false,
};

export function EventSharePanel({
  activeLink,
  canGenerate,
  isClosed,
  action,
}: {
  activeLink: EventShareLinkSummary;
  canGenerate: boolean;
  isClosed: boolean;
  action: EventShareAction;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [qrMessage, setQrMessage] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionUrl = state.sessionUrl;
  const hasActiveLink = Boolean(activeLink) || Boolean(sessionUrl);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || !sessionUrl) {
      return;
    }

    let cancelled = false;

    setQrMessage(null);
    QRCode.toCanvas(canvas, sessionUrl, {
      errorCorrectionLevel: "H",
      margin: 4,
      width: 360,
      color: {
        dark: "#050505",
        light: "#ffffff",
      },
    }).catch(() => {
      if (!cancelled) {
        setQrMessage("Nie udało się wygenerować kodu QR.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [sessionUrl]);

  async function copySessionUrl() {
    if (!sessionUrl) {
      setCopyMessage("Najpierw wygeneruj link sesji.");
      return;
    }

    try {
      await navigator.clipboard.writeText(sessionUrl);
      setCopyMessage("Link skopiowany.");
    } catch {
      setCopyMessage("Nie udało się skopiować linku automatycznie.");
    }
  }

  function downloadQrPng() {
    const canvas = canvasRef.current;

    if (!canvas || !sessionUrl) {
      setQrMessage("Najpierw wygeneruj link sesji.");
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = canvas.toDataURL("image/png");
    anchor.download = "poza-nuta-link-sesji.png";
    anchor.click();
    setQrMessage("Pobieranie QR rozpoczęte.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Link dla gości</CardTitle>
        <CardDescription>
          Goście mogą zeskanować kod QR i dodać utwór z telefonu.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className={styles.settingsForm}>
          {isClosed ? (
            <Alert>
              <AlertDescription>
                Wydarzenie jest zamknięte. Link może pozostać aktywny, ale
                publiczne zgłoszenia nie będą przyjmowane.
              </AlertDescription>
            </Alert>
          ) : null}

          {hasActiveLink ? (
            <p className={styles.eventMeta}>Link sesji jest aktywny.</p>
          ) : (
            <p className={styles.eventMeta}>
              Brak aktywnego linku sesji albo poprzedni link został
              unieważniony.
            </p>
          )}

          {activeLink ? (
            <dl className={styles.eventDetails}>
              <div>
                <dt>Utworzony</dt>
                <dd>{formatDateTime(activeLink.createdAt)}</dd>
              </div>
              <div>
                <dt>Użycia</dt>
                <dd>{activeLink.useCount}</dd>
              </div>
              <div>
                <dt>Ostatnie użycie</dt>
                <dd>
                  {activeLink.lastUsedAt
                    ? formatDateTime(activeLink.lastUsedAt)
                    : "Brak"}
                </dd>
              </div>
            </dl>
          ) : null}

          {!sessionUrl && hasActiveLink ? (
            <p className={styles.eventMeta}>
              Pełny link jest widoczny tylko po wygenerowaniu. W razie potrzeby
              wygeneruj nowy.
            </p>
          ) : null}

          {state.message ? (
            <Alert variant={state.success ? "default" : "destructive"}>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : null}

          {sessionUrl ? (
            <div className={styles.shareGrid}>
              <div className={styles.formSection}>
                <h2>Pełny link sesji</h2>
                <p className={styles.breakValue}>{sessionUrl}</p>
                <div className={styles.formActions}>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={copySessionUrl}
                  >
                    Kopiuj link
                  </Button>
                </div>
                {copyMessage ? (
                  <p className={styles.eventMeta} role="status">
                    {copyMessage}
                  </p>
                ) : null}
              </div>

              <div className={styles.formSection}>
                <h2>Kod QR</h2>
                <div className={styles.qrFrame}>
                  <canvas
                    ref={canvasRef}
                    aria-label="Kod QR z linkiem sesji"
                    width={360}
                    height={360}
                  />
                </div>
                <div className={styles.formActions}>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={downloadQrPng}
                  >
                    Pobierz QR
                  </Button>
                </div>
                {qrMessage ? (
                  <p className={styles.eventMeta} role="status">
                    {qrMessage}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className={styles.formSection}>
              <h2>QR niedostępny</h2>
              <p className={styles.eventMeta}>
                Kod QR pojawi się dopiero po wygenerowaniu linku sesji.
              </p>
            </div>
          )}

          {canGenerate ? (
            <form action={formAction}>
              <Button type="submit" disabled={isPending || isClosed}>
                {isPending
                  ? "Generowanie..."
                  : hasActiveLink
                    ? "Regeneruj link"
                    : "Wygeneruj link sesji"}
              </Button>
            </form>
          ) : (
            <p className={styles.eventMeta}>
              Linkiem sesji zarządza owner, manager albo operator organizacji.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
