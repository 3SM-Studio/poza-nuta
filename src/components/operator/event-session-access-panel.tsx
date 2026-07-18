"use client";

import QRCode from "qrcode";
import { Check, Copy, Download, QrCode } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { SessionStateAlert } from "@/components/public/session-state-alert";
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
          <SessionStateAlert kind="canonical_unavailable" />
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
  const [qrUnavailable, setQrUnavailable] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    setQrUnavailable(false);

    QRCode.toCanvas(canvas, sessionUrl, {
      errorCorrectionLevel: "H",
      margin: 4,
      width: 360,
      color: { dark: "#050505", light: "#ffffff" },
    }).catch(() => {
      if (!cancelled) setQrUnavailable(true);
    });

    return () => {
      cancelled = true;
    };
  }, [sessionUrl]);

  async function copy(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(message);
    } catch {
      toast.error("Nie udało się skopiować", {
        description: "Skopiuj wartość ręcznie.",
      });
    }
  }

  function downloadQrPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const anchor = document.createElement("a");
    anchor.href = canvas.toDataURL("image/png");
    anchor.download = `poza-nuta-${sessionCode}.png`;
    anchor.click();
    toast.info("Pobieranie QR rozpoczęte.");
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
          <SessionStateAlert kind="closed" />
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
            {qrUnavailable ? <SessionStateAlert kind="qr_unavailable" /> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
