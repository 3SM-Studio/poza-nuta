
import { useUiText } from "@/i18n/use-ui-text";
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
import { countActiveParticipantRequests, PARTICIPANT_ACTIVE_REQUEST_LIMIT } from "@/lib/participant-request-policy";

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
  const tx = useUiText();

  return (
    <section aria-labelledby="participant-requests-heading">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold tracking-[-0.04em]" id="participant-requests-heading">{tx("Moje zgłoszenia")}</h2>
          {requests ? <p className="mt-1 text-sm text-muted-foreground">{tx.count("request", requests.length)}</p> : null}
          {requests ? (
            <p className="mt-1 text-sm text-muted-foreground" role="status">
              {tx("Aktywne zgłoszenia: ")}{countActiveParticipantRequests(requests)}/{PARTICIPANT_ACTIVE_REQUEST_LIMIT}
            </p>
          ) : null}
        </div>
        <Button onClick={onRefresh} size="sm" type="button" variant="ghost">{tx("Odśwież")}</Button>
      </div>
      {message ? <p className="text-sm text-destructive" role="alert">{tx(message)}</p> : null}
      {requests === null ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">{tx("Wczytywanie zgłoszeń…")}</p>
      ) : requests.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">{tx("Nie masz jeszcze zgłoszeń w tej sesji.")}</p>
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
                    {tx("Pozycja zgłoszenia w kolejce: #")}{request.queuePosition}
                    {request.isNext ? tx(" · Następne zaakceptowane zgłoszenie") : ""}
                  </p>
                ) : null}
              </div>
              {request.status === "pending" && request.canCancel ? (
                <AlertDialog
                  onOpenChange={(open) => {
                    if (cancellingRequestId !== null) return;
                    onCancelDialogRequestIdChange(open ? request.id : null);
                  }}
                  open={cancelDialogRequestId === request.id}
                >
                  <AlertDialogTrigger asChild>
                    <Button disabled={cancellingRequestId !== null} size="sm" type="button" variant="outline">
                      {cancellingRequestId === request.id ? tx("Anuluję…") : tx("Anuluj")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{tx("Anulować zgłoszenie?")}</AlertDialogTitle>
                      <AlertDialogDescription>{request.title} — {request.artist}{tx(". Tej operacji nie można cofnąć po stronie uczestnika.")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={cancellingRequestId !== null}>{tx("Wróć")}</AlertDialogCancel>
                      <Button disabled={cancellingRequestId !== null} onClick={() => onCancel(request.id)} type="button" variant="destructive">
                        {cancellingRequestId === request.id ? tx("Anuluję…") : tx("Anuluj zgłoszenie")}
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
