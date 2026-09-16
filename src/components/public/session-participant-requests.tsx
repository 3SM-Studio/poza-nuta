import { RequestStatusBadge } from "@/components/request-status-badge";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { ParticipantRequest } from "./session-api";

export function SessionParticipantRequests({
  cancellingRequestId,
  cancelDialogRequestId,
  message,
  onCancel,
  onCancelDialogRequestIdChange,
  onRefresh,
  requests,
}: {
  cancellingRequestId: string | null;
  cancelDialogRequestId: string | null;
  message: string | null;
  onCancel: (requestId: string) => void;
  onCancelDialogRequestIdChange: (requestId: string | null) => void;
  onRefresh: () => void;
  requests: ParticipantRequest[] | null;
}) {
  return (
    <section aria-labelledby="participant-requests-heading">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold tracking-[-0.04em]" id="participant-requests-heading">Moje zgłoszenia</h2>
          {requests ? <p className="mt-1 text-sm text-muted-foreground">{formatRequestCount(requests.length)}</p> : null}
        </div>
        <Button onClick={onRefresh} size="sm" type="button" variant="ghost">Odśwież</Button>
      </div>
      {message ? <p className="text-sm text-destructive" role="alert">{message}</p> : null}
      {requests === null ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">Wczytywanie zgłoszeń…</p>
      ) : requests.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">Nie masz jeszcze zgłoszeń w tej sesji.</p>
      ) : (
        <div className="border-t border-border">
          {requests.map((request) => (
            <article className="flex items-start justify-between gap-4 border-b border-border py-4" data-participant-request-id={request.id} key={request.id}>
              <div className="min-w-0">
                <RequestStatusBadge status={request.status} />
                <h3 className="mt-2 text-base font-extrabold tracking-[-0.02em]">{request.title}</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">{request.artist}</p>
                {request.queuePosition !== null ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Pozycja zgłoszenia w kolejce: #{request.queuePosition}
                    {request.isNext ? " · Następne zaakceptowane zgłoszenie" : ""}
                  </p>
                ) : null}
              </div>
              {request.status === "pending" ? (
                <AlertDialog
                  onOpenChange={(open) => {
                    if (cancellingRequestId !== null) return;
                    onCancelDialogRequestIdChange(open ? request.id : null);
                  }}
                  open={cancelDialogRequestId === request.id}
                >
                  <AlertDialogTrigger asChild>
                    <Button disabled={cancellingRequestId !== null} size="sm" type="button" variant="outline">
                      {cancellingRequestId === request.id ? "Anuluję…" : "Anuluj"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Anulować zgłoszenie?</AlertDialogTitle>
                      <AlertDialogDescription>{request.title} — {request.artist}. Tej operacji nie można cofnąć po stronie uczestnika.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={cancellingRequestId !== null}>Wróć</AlertDialogCancel>
                      <Button disabled={cancellingRequestId !== null} onClick={() => onCancel(request.id)} type="button" variant="destructive">
                        {cancellingRequestId === request.id ? "Anuluję…" : "Anuluj zgłoszenie"}
                      </Button>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function formatRequestCount(count: number) {
  if (count === 1) return "1 zgłoszenie";
  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)) return `${count} zgłoszenia`;
  return `${count} zgłoszeń`;
}
