"use client";

import { useEffect, useRef, useState } from "react";
import { Shuffle } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { OperatorClientError } from "./api";
import { applyDashboardFairQueue, previewDashboardFairQueue, type DashboardEventQueueItemDto, type FairQueuePreview } from "./event-queue-api";

export function FairQueueControl({ organizationId, eventId, disabled, onApplied, onBusyChange }: {
  organizationId: string; eventId: string; disabled: boolean;
  onApplied: (items: DashboardEventQueueItemDto[]) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<FairQueuePreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);

  function operation(kind: "preview" | "apply") {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(kind); setError(null); onBusyChange(true);
    return request;
  }
  function finish(request: AbortController) {
    if (controller.current !== request) return;
    controller.current = null; setBusy(null); onBusyChange(false);
  }
  function fail(caught: unknown, fallback: string) {
    if (caught instanceof OperatorClientError && caught.status === 401) {
      window.location.replace("/sign-in"); return;
    }
    setPreview(null);
    setError(caught instanceof OperatorClientError && caught.code === "FAIR_QUEUE_PREVIEW_STALE"
      ? "Kolejka zmieniła się od podglądu. Przygotuj nowy podgląd i sprawdź zmiany."
      : caught instanceof OperatorClientError && caught.status === 403
        ? "Nie masz uprawnień do zmiany tej kolejki."
        : caught instanceof OperatorClientError && caught.code === "EVENT_QUEUE_CLOSED"
          ? "Wydarzenie jest zamknięte. Nie można zmienić kolejności."
          : fallback);
  }
  async function loadPreview() {
    if (disabled || busy) return;
    const request = operation("preview");
    setPreview(null);
    try {
      const result = await previewDashboardFairQueue(organizationId, eventId, request.signal);
      if (!request.signal.aborted) setPreview(result);
    } catch (caught) {
      if (!request.signal.aborted) fail(caught, "Nie udało się pobrać podglądu. Spróbuj ponownie.");
    } finally { finish(request); }
  }
  async function apply() {
    if (disabled || busy || !preview) return;
    const request = operation("apply");
    try {
      const result = await applyDashboardFairQueue(organizationId, eventId, preview.revision, request.signal);
      if (request.signal.aborted) return;
      onApplied(result.items);
      setOpen(false); setPreview(null);
      toast.success(result.changed ? "Kolejka ułożona sprawiedliwie" : "Kolejka ma już proponowaną kolejność");
    } catch (caught) {
      if (!request.signal.aborted) fail(caught, "Nie udało się potwierdzić zmiany. Pobierz nowy podgląd, aby sprawdzić zapisany stan.");
    } finally { finish(request); }
  }
  const changed = preview?.changes.some(row => row.from !== row.to) ?? false;
  return <Dialog open={open} onOpenChange={value => {
    if (busy === "apply") return;
    if (!value) {
      controller.current?.abort(); controller.current = null;
      setBusy(null); onBusyChange(false); setPreview(null); setError(null);
    }
    setOpen(value);
    if (value) void loadPreview();
  }}>
    <DialogTrigger asChild>
      <Button type="button" variant="outline" disabled={disabled || busy !== null}>
        <Shuffle aria-hidden="true" data-icon="inline-start" />Ułóż sprawiedliwie
      </Button>
    </DialogTrigger>
    <DialogContent className="max-h-[85dvh] overflow-y-auto" showCloseButton={busy !== "apply"}>
      <DialogHeader>
        <DialogTitle>Ułóż sprawiedliwie</DialogTitle>
        <DialogDescription>
          Sprawdź proponowaną kolejność zaakceptowanych utworów. Zastosowanie zastąpi ręczne ustawienie; aktualny występ pozostanie na miejscu.
        </DialogDescription>
      </DialogHeader>
      {busy === "preview" ? <p role="status">Przygotowywanie podglądu…</p> : null}
      {error ? <Alert variant="destructive"><AlertTitle>Nie zastosowano podglądu</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {preview ? <>
        <p className="text-sm text-muted-foreground" role="status">
          {!preview.changes.length ? "Brak zaakceptowanych utworów do ułożenia." : changed ? "Pozycje przed zmianą → proponowane pozycje" : "Kolejka ma już proponowaną kolejność."}
        </p>
        <ol className="grid gap-2" aria-label="Proponowana kolejność">
          {preview.changes.map(row => <li key={row.id} className="flex min-w-0 items-start gap-3 rounded-lg border p-3" data-fair-request-id={row.id}>
            <span className="shrink-0 tabular-nums" aria-label={`Pozycja ${row.from}, proponowana ${row.to}`}>{row.from} → {row.to}</span>
            <span className="min-w-0 break-words"><span className="block font-medium">{row.songTitle}</span><span className="text-sm text-muted-foreground">{row.displayName}</span></span>
          </li>)}
        </ol>
      </> : null}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy === "apply"} onClick={() => {
          controller.current?.abort(); controller.current = null;
          setBusy(null); onBusyChange(false); setOpen(false); setPreview(null); setError(null);
        }}>Anuluj</Button>
        {!preview ? <Button type="button" disabled={disabled || busy !== null} onClick={() => void loadPreview()}>Odśwież podgląd</Button> :
          <Button type="button" disabled={disabled || busy !== null || !preview.changes.length} onClick={() => void apply()}>
            {busy === "apply" ? "Zapisywanie…" : "Zastosuj kolejność"}
          </Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
