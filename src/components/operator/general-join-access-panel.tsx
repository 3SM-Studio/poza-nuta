"use client";

import { Check, CircleAlert, Download, ExternalLink, QrCode } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SessionStateAlert } from "@/components/public/session-state-alert";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createBrandedSessionQrSvg,
  SESSION_QR_MIME_TYPE,
  toSessionQrSvgDataUrl,
  toStandaloneSessionQrSvg,
} from "@/lib/branded-session-qr";

const GENERAL_JOIN_QR_DOWNLOAD_FILENAME = "poza-nuta-join-qr.svg";

export function GeneralJoinAccessPanel({
  joinUrl,
}: {
  joinUrl: string | null;
}) {
  if (!joinUrl) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ogólny kod wejścia</CardTitle>
          <CardDescription>
            Ten link prowadzi do formularza, w którym uczestnik wpisuje kod
            wydarzenia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <CircleAlert aria-hidden="true" />
            <AlertTitle>Ogólny adres jest chwilowo niedostępny</AlertTitle>
            <AlertDescription>
              Sprawdź konfigurację kanonicznego adresu aplikacji i odśwież
              stronę.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return <AvailableGeneralJoinAccessPanel joinUrl={joinUrl} />;
}

function AvailableGeneralJoinAccessPanel({ joinUrl }: { joinUrl: string }) {
  const [qrState, setQrState] = useState<{
    joinUrl: string;
    svg: string | null;
    unavailable: boolean;
  }>({ joinUrl, svg: null, unavailable: false });
  const qrSvg = qrState.joinUrl === joinUrl ? qrState.svg : null;
  const qrDataUrl = qrSvg ? toSessionQrSvgDataUrl(qrSvg) : null;
  const qrUnavailable = qrState.joinUrl === joinUrl && qrState.unavailable;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const svg = await createBrandedSessionQrSvg(joinUrl);
        if (!cancelled) {
          setQrState({ joinUrl, svg, unavailable: false });
        }
      } catch {
        if (!cancelled) {
          setQrState({ joinUrl, svg: null, unavailable: true });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [joinUrl]);

  async function copyJoinUrl() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      toast.success("Ogólny link skopiowany.");
    } catch {
      toast.error("Nie udało się skopiować", {
        description: "Skopiuj link ręcznie.",
      });
    }
  }

  function downloadQrSvg() {
    if (!qrSvg) {
      toast.error("Kod QR nie jest jeszcze gotowy.");
      return;
    }

    let objectUrl: string | null = null;
    try {
      const blob = new Blob([toStandaloneSessionQrSvg(qrSvg)], {
        type: SESSION_QR_MIME_TYPE,
      });
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = GENERAL_JOIN_QR_DOWNLOAD_FILENAME;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      toast.success("Ogólny kod QR został pobrany.");
    } catch {
      toast.error("Nie udało się pobrać kodu QR.", {
        description: "Spróbuj ponownie za chwilę.",
      });
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Ogólny kod wejścia</CardTitle>
        <CardDescription>
          Uczestnik trafia na stronę dołączania i sam wpisuje ośmiocyfrowy kod
          właściwego wydarzenia.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid min-w-0 grid-cols-1 gap-4 min-[60rem]:grid-cols-[minmax(0,1fr)_minmax(16rem,24rem)]">
          <div className="grid min-w-0 content-start gap-3 rounded-md border border-border bg-muted/30 p-4">
            <h2 className="text-base font-semibold leading-snug">
              Link ogólny
            </h2>
            <a
              className="min-w-0 break-all text-primary underline underline-offset-4 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={joinUrl}
              rel="noreferrer"
              target="_blank"
            >
              {joinUrl}
              <ExternalLink
                aria-hidden="true"
                className="ml-1 inline-block size-4"
              />
            </a>
            <p className="text-sm text-muted-foreground">
              Ten adres nie wskazuje jednego wydarzenia i może być używany na
              stałych materiałach organizatora.
            </p>
            <Button
              className="justify-self-start"
              onClick={() => void copyJoinUrl()}
              type="button"
              variant="outline"
            >
              <Check data-icon="inline-start" />
              Kopiuj link ogólny
            </Button>
          </div>

          <div className="grid min-w-0 content-start gap-3 rounded-md border border-border bg-muted/30 p-4">
            <h2 className="flex items-center gap-2 text-base font-semibold leading-snug">
              <QrCode aria-hidden="true" />
              Ogólny kod QR
            </h2>
            <div className="mx-auto grid aspect-square w-full min-w-0 max-w-sm place-items-center overflow-clip rounded-md bg-white p-3 sm:p-4">
              {qrDataUrl ? (
                // The QR is a generated data URL, so Next image optimization is not applicable.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt="Kod QR prowadzący do ogólnej strony dołączania"
                  className="block h-auto w-full max-w-full"
                  src={qrDataUrl}
                />
              ) : qrUnavailable ? null : (
                <Skeleton className="size-full min-h-48" />
              )}
            </div>
            <Button
              className="mx-auto w-full max-w-sm whitespace-normal"
              disabled={!qrSvg}
              onClick={downloadQrSvg}
              type="button"
              variant="outline"
            >
              <Download data-icon="inline-start" />
              Pobierz ogólny QR (SVG)
            </Button>
            {qrUnavailable ? <SessionStateAlert kind="qr_unavailable" /> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
