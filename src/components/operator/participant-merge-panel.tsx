"use client";

import { useUiText } from "@/i18n/use-ui-text";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ParticipantMergePreview } from "@/components/participant-merge-preview";
import { participantLinkingError, type ParticipantMergeView } from "@/lib/participant-linking";
import { participantApi, type EventParticipantSummary } from "./event-participants-api";

export function ParticipantMergePanel({ base, participants, onCompleted }: { base: string; participants: EventParticipantSummary[]; onCompleted: (id: number) => Promise<void> }) {
  const tx = useUiText();

  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [proposal, setProposal] = useState<ParticipantMergeView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const confirmTrigger = useRef<HTMLButtonElement>(null);
  function backToProposal() {
    setConfirm(false);
    requestAnimationFrame(() => confirmTrigger.current?.focus());
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null); setMessage(null);
    try { await action(); } catch (caught) { setError(participantLinkingError(caught)); }
    finally { setBusy(false); }
  }
  const ready = proposal && !proposal.stale && !proposal.conflict && !proposal.completedAt && !proposal.cancelledAt && proposal.targetConsented && (!proposal.sourceConsentRequired || proposal.sourceConsented);
  return <>
    <Dialog open={open} onOpenChange={value => { if (!busy && (!confirm || value)) setOpen(value); }}>
      <DialogTrigger asChild><Button variant="outline">{tx("Połącz profile")}</Button></DialogTrigger>
      <DialogContent role={confirm ? "alertdialog" : "dialog"} showCloseButton={!confirm && !busy} onEscapeKeyDown={event => { if (confirm) { event.preventDefault(); if (!busy) backToProposal(); } }} onInteractOutside={event => { if (confirm || busy) event.preventDefault(); }} className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{confirm ? tx("Połączyć oba profile w tym wydarzeniu?") : tx("Połącz profile uczestnika")}</DialogTitle><DialogDescription>{confirm ? tx("Historia i aktywne zgłoszenia przejdą do profilu „{v0}”. Oba urządzenia zachowają dostęp do wspólnego profilu w tym wydarzeniu. Operacja wymaga świadomego potwierdzenia własności.", {v0: proposal?.target.displayName}) : tx("Wskaż dwa odrębne profile tej samej osoby. Profil ręczny wybierz jako źródło. Uczestnik musi potwierdzić propozycję na swoim urządzeniu.")}</DialogDescription></DialogHeader>
        {confirm ? <div className="grid gap-3"><Button variant="outline" disabled={busy} onClick={backToProposal}>{tx("Wróć bez łączenia")}</Button><Button disabled={busy} onClick={() => void run(async () => {
          if (!proposal) return;
          const result = await participantApi<{ targetParticipantId: number }>(`${base}/merges/${proposal.id}`, { method: "POST", body: JSON.stringify({ action: "complete" }) });
          await onCompleted(result.targetParticipantId);
          setConfirm(false); setProposal(null); setMessage("Profile zostały połączone. Historia i zgłoszenia zachowane.");
        })}>{tx("Tak, połącz profile")}</Button>{error ? <p role="alert" className="text-sm text-destructive">{tx(error)}</p> : null}</div> : <div className="grid min-w-0 gap-4">
          {error ? <p role="alert" className="text-sm text-destructive">{tx(error)}</p> : null}{message ? <p role="status" className="text-sm">{tx(message)}</p> : null}
          <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void run(async () => setProposal(await participantApi<ParticipantMergeView>(`${base}/merges`, { method: "POST", body: JSON.stringify({ sourceId: Number(source), targetId: Number(target) }) }))); }}>
            <Label htmlFor="merge-source">{tx("Profil źródłowy (zachowamy historię)")}</Label><select className="h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm" id="merge-source" required value={source} onChange={event => setSource(event.target.value)} disabled={busy}><option value="">{tx("Wybierz profil źródłowy")}</option>{participants.map(person => <option key={person.id} value={person.id}>{person.displayName} {tx(" · aktywne ")}{person.activeCount}/2</option>)}</select>
            <Label htmlFor="merge-target">{tx("Profil docelowy (pozostanie ten nick)")}</Label><select className="h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm" id="merge-target" required value={target} onChange={event => setTarget(event.target.value)} disabled={busy}><option value="">{tx("Wybierz profil docelowy")}</option>{participants.map(person => <option key={person.id} value={person.id} disabled={String(person.id) === source}>{person.displayName} {tx(" · aktywne ")}{person.activeCount}/2</option>)}</select>
            <Button disabled={busy || !source || !target || source === target} type="submit">{tx("Utwórz propozycję połączenia")}</Button>
          </form>
          {proposal ? <section className="grid gap-4 border-t pt-4" aria-label={tx("Propozycja połączenia")}><ParticipantMergePreview proposal={proposal} />
            <p className="text-sm">{tx("Poproś właściciela profili o otwarcie „Urządzenia i łączenie profili” i potwierdzenie własności. Dwa profile z urządzeniami wymagają dwóch zgód.")}</p>
            <Button variant="outline" disabled={busy} onClick={() => void run(async () => setProposal(await participantApi<ParticipantMergeView>(`${base}/merges/${proposal.id}`)))}>{tx("Odśwież potwierdzenia")}</Button>
            <Button ref={confirmTrigger} disabled={busy || !ready} onClick={() => setConfirm(true)}>{tx("Zatwierdź połączenie profili")}</Button>
            {!proposal.completedAt && !proposal.cancelledAt ? <Button variant="outline" disabled={busy} onClick={() => void run(async () => { await participantApi(`${base}/merges/${proposal.id}`, { method: "POST", body: JSON.stringify({ action: "cancel" }) }); setProposal(null); setMessage("Propozycja anulowana."); })}>{tx("Anuluj propozycję")}</Button> : null}
          </section> : null}
          {busy ? <p role="status" className="text-sm">{tx("Przetwarzanie…")}</p> : null}
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
