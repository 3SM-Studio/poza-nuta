"use client";

import QRCode from "qrcode";
import { Check, Copy, Download, QrCode } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

export function EventSessionAccessPanel({
  sessionCode,
  sessionUrl,
  isClosed,
}: {
  sessionCode: string;
  sessionUrl: string | null;
  isClosed: boolean;
}) {
  if (!sessionUrl) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Dostęp do sesji</CardTitle>
          <CardDescription>
            Jeden stały kod wydarzenia prowadzi do kolejki uczestników.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertDescription>
              Adres sesji jest chwilowo niedostępny.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <AvailableEventSessionAccessPanel
      sessionCode={sessionCode}
      sessionUrl={sessionUrl}
      isClosed={isClosed}
    />
  );
}

function AvailableEventSessionAccessPanel({
  sessionCode,
  sessionUrl,
  isClosed,
}: {
  sessionCode: string;
  sessionUrl: string;
  isClosed: boolean;
}) {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [qrMessage, setQrMessage] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    setQrMessage(null);

    QRCode.toCanvas(canvas, sessionUrl, {
      errorCorrectionLevel: "H",
      margin: 4,
      width: 360,
      color: { dark: "#050505", light: "#ffffff" },
    }).catch(() => {
      if (!cancelled) setQrMessage("Nie udało się wygenerować kodu QR.");
    });

    return () => {
      cancelled = true;
    };
  }, [sessionUrl]);

  async function copy(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(message);
    } catch {
      setCopyMessage("Nie udało się skopiować automatycznie.");
    }
  }

  function downloadQrPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const anchor = document.createElement("a");
    anchor.href = canvas.toDataURL("image/png");
    anchor.download = `poza-nuta-${sessionCode}.png`;
    anchor.click();
    setQrMessage("Pobieranie QR rozpoczęte.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dostęp do sesji</CardTitle>
        <CardDescription>
          Jeden stały kod wydarzenia prowadzi do kolejki uczestników.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {isClosed ? (
          <Alert>
            <AlertDescription>
              Sesja została zakończona. Kod pozostaje przypisany do wydarzenia,
              ale nie pozwala dodawać zgłoszeń.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className={styles.shareGrid}>
          <div className={styles.formSection}>
            <h2>Kod sesji</h2>
            <p className="font-mono text-3xl font-semibold tracking-widest">
              {sessionCode}
            </p>
            <p className={styles.breakValue}>{sessionUrl}</p>
            <div className={styles.formActions}>
              <Button
                type="button"
                variant="outline"
                onClick={() => void copy(sessionCode, "Kod skopiowany.")}
              >
                <Copy aria-hidden="true" />
                Kopiuj kod
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void copy(sessionUrl, "Link skopiowany.")}
              >
                <Check aria-hidden="true" />
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
            <h2 className="flex items-center gap-2">
              <QrCode aria-hidden="true" />
              Kod QR
            </h2>
            <div className={styles.qrFrame}>
              <canvas
                ref={canvasRef}
                aria-label={`Kod QR prowadzący do sesji ${sessionCode}`}
                width={360}
                height={360}
              />
            </div>
            <Button type="button" variant="outline" onClick={downloadQrPng}>
              <Download aria-hidden="true" />
              Pobierz QR
            </Button>
            {qrMessage ? (
              <p className={styles.eventMeta} role="status">
                {qrMessage}
              </p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
