"use client";

import { Check, Copy, Download, QrCode } from "lucide-react";
import { useEffect, useState } from "react";
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
import {
  createBrandedSessionQrSvg,
  SESSION_QR_DOWNLOAD_FILENAME,
  SESSION_QR_MIME_TYPE,
  toSessionQrSvgDataUrl,
  toStandaloneSessionQrSvg,
} from "@/lib/branded-session-qr";


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
  const [qrState, setQrState] = useState<{
    sessionUrl: string;
    svg: string | null;
    unavailable: boolean;
  }>({ sessionUrl, svg: null, unavailable: false });
  const qrSvg = qrState.sessionUrl === sessionUrl ? qrState.svg : null;
  const qrDataUrl = qrSvg ? toSessionQrSvgDataUrl(qrSvg) : null;
  const qrUnavailable =
    qrState.sessionUrl === sessionUrl && qrState.unavailable;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const svg = await createBrandedSessionQrSvg(sessionUrl);
        if (!cancelled) {
          setQrState({ sessionUrl, svg, unavailable: false });
        }
      } catch {
        if (!cancelled) {
          setQrState({ sessionUrl, svg: null, unavailable: true });
        }
      }
    })();

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
      anchor.download = SESSION_QR_DOWNLOAD_FILENAME;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      toast.success("Kod QR został pobrany.");
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
        <CardTitle>Dostęp do sesji</CardTitle>
        <CardDescription>
          Jeden stały kod wydarzenia prowadzi do kolejki uczestników.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-5">
        {isClosed ? (
          <SessionStateAlert kind="closed" />
        ) : null}

        <div className="grid min-w-0 grid-cols-1 gap-4 min-[60rem]:grid-cols-[minmax(0,1fr)_minmax(16rem,24rem)]">
          <div className={"grid min-w-0 gap-3 rounded-md border border-border bg-muted/30 p-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:leading-snug"}>
            <h2>Kod sesji</h2>
            <p className="max-w-full break-all font-mono text-[clamp(1.75rem,9vw,3rem)] font-semibold tracking-[0.12em]">
              {sessionCode}
            </p>
            <p className={"min-w-0 break-all [overflow-wrap:anywhere]"}>{sessionUrl}</p>
            <div className={"flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&>*]:max-w-full"}>
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

          <div className={`${"grid min-w-0 gap-3 rounded-md border border-border bg-muted/30 p-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:leading-snug"} ${"min-w-0 content-start"}`}>
            <h2 className="flex items-center gap-2">
              <QrCode aria-hidden="true" />
              Kod QR
            </h2>
            <div className={"mx-auto grid aspect-square w-full min-w-0 max-w-sm place-items-center overflow-clip rounded-md bg-white p-3 sm:p-4"}>
              {qrDataUrl ? (
                // The QR is a generated data URL, so Next image optimization is not applicable.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="block h-auto w-full max-w-full"
                  src={qrDataUrl}
                  alt="Kod QR prowadzący do stałego adresu sesji"
                />
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              className={"mx-auto w-full max-w-sm whitespace-normal"}
              disabled={!qrSvg}
              onClick={downloadQrSvg}
            >
              <Download aria-hidden="true" />
              Pobierz QR (SVG)
            </Button>
            {qrUnavailable ? <SessionStateAlert kind="qr_unavailable" /> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
