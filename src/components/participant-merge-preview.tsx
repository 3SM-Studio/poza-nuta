
import { useUiText } from "@/i18n/use-ui-text";
import type { ParticipantMergeView } from "@/lib/participant-linking";
import { RequestStatusBadge } from "@/components/request-status-badge";

export function ParticipantMergePreview({ proposal }: { proposal: ParticipantMergeView }) {
  const tx = useUiText();

  return <div className="grid min-w-0 gap-4">
    <p className="text-sm">{tx("Dwa odrębne profile zostaną połączone w tym wydarzeniu. Docelowy nick: ")}<strong>{proposal.target.displayName}</strong>{tx(". Historia i urządzenia obu profili pozostaną dostępne. Inne wydarzenia pozostają osobne.")}</p>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">{[proposal.source, proposal.target].map((profile, index) => <section key={index} className="min-w-0 rounded-lg border p-3" aria-label={index === 0 ? tx("Profil źródłowy") : tx("Profil docelowy")}>
      <h4 className="break-words font-semibold">{profile.displayName}</h4><p className="my-2 text-sm">{tx("Aktywne: ")}{profile.activeCount}/2</p>
      {profile.requests.length ? <ul className="max-h-52 space-y-3 overflow-y-auto">{profile.requests.map(request => <li key={request.id} className="text-sm"><RequestStatusBadge status={request.status} /><p className="mt-1 break-words">{request.title} · {request.artist}</p><p className="text-xs text-muted-foreground">{tx.date(request.createdAt)}</p></li>)}</ul> : <p className="text-sm text-muted-foreground">{tx("Brak zgłoszeń.")}</p>}
    </section>)}</div>
    <p className="text-sm">{tx("Potwierdzenie źródła: ")}{proposal.sourceConsentRequired ? proposal.sourceConsented ? tx("otrzymane") : tx("oczekuje") : tx("profil ręczny — potwierdza operator")}{tx(". Potwierdzenie celu: ")}{proposal.targetConsented ? tx("otrzymane") : tx("oczekuje")}.</p>
    {proposal.conflict ? <p role="alert" className="text-sm text-destructive">{proposal.conflict === "limit" ? tx("Konflikt: więcej niż 2 aktywne zgłoszenia łącznie.") : tx("Konflikt: aktywny duplikat tej samej piosenki.")} {tx(" Operator musi rozwiązać konflikt w kolejce. Żadne zgłoszenie nie zostanie odrzucone automatycznie.")}</p> : null}
    <p className="text-xs text-muted-foreground">{tx("Ważne do ")}{tx.date(proposal.expiresAt)}.</p>
    {proposal.stale || proposal.cancelledAt ? <p role="alert" className="text-sm text-destructive">{tx("Propozycja jest nieaktualna lub anulowana. Potrzebna jest nowa.")}</p> : null}
  </div>;
}
