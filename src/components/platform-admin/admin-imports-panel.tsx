"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BanIcon,
  CheckCircle2Icon,
  LoaderCircleIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchCheckIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  activeImportRefreshMilliseconds,
  getImportJobProgress,
  hasActiveImportJob,
  type ImportAdminActionResult,
  type ImportAdminPageData,
  type ImportJobViewModel,
} from "@/server/platform-admin/import-admin-core";

type AdminImportsPanelProps = {
  data: ImportAdminPageData;
  startDryRun: () => Promise<ImportAdminActionResult>;
  startWrite: () => Promise<ImportAdminActionResult>;
  cancelJob: (importJobId: number) => Promise<ImportAdminActionResult>;
};

const statusLabels: Record<ImportJobViewModel["status"], string> = {
  queued: "Oczekuje",
  running: "W toku",
  succeeded: "Zakończony",
  failed: "Błąd",
  cancelled: "Anulowany",
};

export function AdminImportsPanel({
  data,
  startDryRun,
  startWrite,
  cancelJob,
}: AdminImportsPanelProps) {
  const router = useRouter();
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [message, setMessage] = useState<ImportAdminActionResult | null>(null);
  const [writeConfirmationOpen, setWriteConfirmationOpen] = useState(false);
  const [cancelConfirmationJob, setCancelConfirmationJob] =
    useState<ImportJobViewModel | null>(null);
  const [isRefreshing, startRefreshTransition] = useTransition();
  const hasActiveJob = hasActiveImportJob(data.jobs);
  const hasActiveISingJob = data.jobs.some(
    (job) =>
      job.source === "ising" &&
      (job.status === "queued" || job.status === "running"),
  );
  const isBusy = activeAction !== null;

  useEffect(() => {
    if (!hasActiveJob) return;

    const interval = window.setInterval(() => {
      startRefreshTransition(() => router.refresh());
    }, activeImportRefreshMilliseconds);

    return () => window.clearInterval(interval);
  }, [hasActiveJob, router]);

  async function runMutation(
    key: string,
    operation: () => Promise<ImportAdminActionResult>,
  ) {
    setActiveAction(key);
    setMessage(null);

    try {
      const result = await operation();
      setMessage(result);
      if (key === "write") setWriteConfirmationOpen(false);
      if (key.startsWith("cancel:")) setCancelConfirmationJob(null);
      startRefreshTransition(() => router.refresh());
    } catch {
      setMessage({
        kind: "error",
        message: "Nie udało się wykonać operacji. Spróbuj ponownie.",
      });
    } finally {
      setActiveAction(null);
    }
  }

  function refresh() {
    setMessage(null);
    startRefreshTransition(() => router.refresh());
  }

  const startsDisabled =
    isBusy ||
    hasActiveISingJob ||
    !data.capabilities.canStartISing;

  return (
    <div className="grid gap-6">
      <header className="grid gap-1">
        <p className="m-0 text-sm font-medium text-primary">Katalog</p>
        <h1 className="m-0 text-2xl font-semibold tracking-normal sm:text-3xl">
          Importy
        </h1>
        <p className="m-0 max-w-3xl text-sm text-muted-foreground sm:text-base">
          Uruchamiaj zadania iSing i obserwuj postęp procesu importu.
        </p>
      </header>

      <section
        aria-label="Akcje importu"
        className="flex flex-col gap-3 border-y border-border py-4 sm:flex-row sm:items-center"
      >
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void runMutation("dry-run", startDryRun)}
            disabled={startsDisabled}
          >
            {activeAction === "dry-run" ? (
              <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
            ) : (
              <SearchCheckIcon aria-hidden="true" />
            )}
            {activeAction === "dry-run" ? "Dodawanie…" : "Sprawdź iSing"}
          </Button>
          <Button
            type="button"
            onClick={() => setWriteConfirmationOpen(true)}
            disabled={startsDisabled}
            aria-haspopup="dialog"
          >
            <PlayIcon aria-hidden="true" />
            Importuj iSing
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="sm:ml-auto"
          onClick={refresh}
          disabled={isRefreshing || isBusy}
        >
          <RefreshCwIcon
            className={isRefreshing ? "animate-spin" : undefined}
            aria-hidden="true"
          />
          {isRefreshing ? "Odświeżanie…" : "Odśwież"}
        </Button>
      </section>

      {!data.capabilities.canStartISing ? (
        <p className="m-0 text-sm text-muted-foreground">
          Masz dostęp tylko do odczytu historii importów.
        </p>
      ) : hasActiveISingJob ? (
        <p className="m-0 text-sm text-muted-foreground">
          Nowy import iSing będzie dostępny po zakończeniu aktywnego joba.
        </p>
      ) : null}

      <div aria-live="polite" aria-atomic="true">
        {message ? (
          <Alert variant={message.kind === "error" ? "destructive" : "default"}>
            {message.kind === "error" ? (
              <BanIcon aria-hidden="true" />
            ) : (
              <CheckCircle2Icon aria-hidden="true" />
            )}
            <AlertTitle>
              {message.kind === "error" ? "Operacja nieudana" : "Gotowe"}
            </AlertTitle>
            <AlertDescription>{message.message}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <section aria-labelledby="recent-import-jobs" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="recent-import-jobs" className="m-0 text-lg font-semibold">
            Ostatnie zadania
          </h2>
          {hasActiveJob ? (
            <Badge variant="default">Automatyczne odświeżanie</Badge>
          ) : (
            <Badge variant="secondary">Brak aktywnego zadania</Badge>
          )}
        </div>

        {data.jobs.length === 0 ? (
          <div className="border-t border-border py-10 text-center text-sm text-muted-foreground">
            Historia importów jest pusta.
          </div>
        ) : (
          <div className="divide-y divide-border border-y border-border">
            {data.jobs.map((job) => (
              <ImportJobRow
                key={job.id}
                job={job}
                canCancel={data.capabilities.canCancel}
                isCancelling={activeAction === `cancel:${job.id}`}
                actionsDisabled={isBusy}
                onCancel={() => setCancelConfirmationJob(job)}
              />
            ))}
          </div>
        )}
      </section>

      <AlertDialog
        open={writeConfirmationOpen}
        onOpenChange={(open) => {
          if (!open && activeAction !== "write") setWriteConfirmationOpen(false);
        }}
      >
        <AlertDialogContent data-management-theme="true">
          <AlertDialogHeader>
            <AlertDialogTitle>Uruchomić zapis iSing?</AlertDialogTitle>
            <AlertDialogDescription>
              Worker zaktualizuje katalog przez bezpieczny upsert. Istniejące
              piosenki nie będą usuwane.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={activeAction === "write"}>
              Wróć
            </AlertDialogCancel>
            <Button
              type="button"
              onClick={() => void runMutation("write", startWrite)}
              disabled={activeAction === "write"}
            >
              {activeAction === "write" ? (
                <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
              ) : (
                <PlayIcon aria-hidden="true" />
              )}
              {activeAction === "write" ? "Dodawanie…" : "Tak, importuj"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={cancelConfirmationJob !== null}
        onOpenChange={(open) => {
          if (!open && !activeAction?.startsWith("cancel:")) {
            setCancelConfirmationJob(null);
          }
        }}
      >
        <AlertDialogContent data-management-theme="true">
          <AlertDialogHeader>
            <AlertDialogTitle>Anulować job importu?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelConfirmationJob?.status === "queued"
                ? "Job oczekujący zostanie anulowany przed uruchomieniem."
                : "Worker otrzyma żądanie bezpiecznego anulowania po bieżącym batchu."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={activeAction?.startsWith("cancel:") ?? false}
            >
              Wróć
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (!cancelConfirmationJob) return;
                const jobId = cancelConfirmationJob.id;
                void runMutation(`cancel:${jobId}`, () => cancelJob(jobId));
              }}
              disabled={activeAction?.startsWith("cancel:") ?? false}
            >
              {activeAction?.startsWith("cancel:") ? (
                <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
              ) : (
                <BanIcon aria-hidden="true" />
              )}
              {activeAction?.startsWith("cancel:")
                ? "Anulowanie…"
                : "Tak, anuluj"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ImportJobRow({
  job,
  canCancel,
  isCancelling,
  actionsDisabled,
  onCancel,
}: {
  job: ImportJobViewModel;
  canCancel: boolean;
  isCancelling: boolean;
  actionsDisabled: boolean;
  onCancel: () => void;
}) {
  const active = job.status === "queued" || job.status === "running";
  const progress = getImportJobProgress(job.totalCount, job.processedCount);

  return (
    <article className="grid gap-4 py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 text-base font-semibold">
              {sourceLabel(job.source)} · {modeLabel(job.mode)}
            </h3>
            <StatusBadge status={job.status} />
            {job.cancellationRequested ? (
              <Badge variant="outline">Anulowanie zażądane</Badge>
            ) : null}
          </div>
          <p className="mt-1 mb-0 text-sm text-muted-foreground">
            Inicjator: {initiatorLabel(job.initiatorKind)} · utworzono{" "}
            {formatDateTime(job.createdAt)}
          </p>
        </div>
        {active ? (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={onCancel}
            disabled={
              !canCancel ||
              actionsDisabled ||
              isCancelling ||
              job.cancellationRequested
            }
          >
            {isCancelling ? (
              <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
            ) : (
              <BanIcon aria-hidden="true" />
            )}
            {isCancelling ? "Anulowanie…" : "Anuluj"}
          </Button>
        ) : null}
      </div>

      {active ? <ImportProgress progress={progress} /> : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Łącznie" value={job.totalCount ?? "—"} />
        <Metric label="Przetworzone" value={job.processedCount} />
        <Metric
          label={job.mode === "dry_run" ? "Poprawne" : "Zaimportowane"}
          value={job.importedCount}
        />
        <Metric label="Pominięte" value={job.skippedCount} />
        <Metric label="Błędy" value={job.errorCount ?? "—"} />
        <Metric
          label="Zakończono"
          value={job.terminalAt ? formatDateTime(job.terminalAt) : "—"}
        />
      </dl>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <Metric label="Start" value={formatDateTime(job.startedAt)} />
        <Metric
          label="Żądanie anulowania"
          value={formatDateTime(job.cancellationRequestedAt)}
        />
      </dl>

      {job.safeErrorCode || job.safeErrorSummary ? (
        <Alert variant="destructive">
          <AlertTitle>{job.safeErrorCode ?? "IMPORT_FAILED"}</AlertTitle>
          <AlertDescription>
            {job.safeErrorSummary ?? "Import zakończył się bezpiecznym błędem."}
          </AlertDescription>
        </Alert>
      ) : null}
    </article>
  );
}

function ImportProgress({
  progress,
}: {
  progress: ReturnType<typeof getImportJobProgress>;
}) {
  if (progress.kind === "unknown") {
    return (
      <p className="m-0 text-sm text-muted-foreground" role="status">
        Przetworzono {progress.processedCount}; suma nie jest jeszcze znana.
      </p>
    );
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex justify-between gap-3 text-sm">
        <span>Postęp</span>
        <span className="tabular-nums">
          {progress.processedCount}/{progress.totalCount} · {progress.percent}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Postęp importu"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ImportJobViewModel["status"] }) {
  const variant =
    status === "failed"
      ? "destructive"
      : status === "succeeded"
        ? "default"
        : status === "cancelled"
          ? "outline"
          : "secondary";
  return <Badge variant={variant}>{statusLabels[status]}</Badge>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 break-words font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Warsaw",
  }).format(new Date(value));
}

function sourceLabel(source: ImportJobViewModel["source"]) {
  return source === "ising" ? "iSing" : "KaraFun";
}

function modeLabel(mode: ImportJobViewModel["mode"]) {
  if (mode === "dry_run") return "sprawdzenie";
  if (mode === "write") return "zapis";
  return "walidacja";
}

function initiatorLabel(initiator: ImportJobViewModel["initiatorKind"]) {
  if (initiator === "operator") return "operator";
  if (initiator === "system") return "system";
  return "legacy";
}
