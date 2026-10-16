"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ParticipantMergePreview } from "@/components/participant-merge-preview";
import { participantLinkingError, type DeviceLink, type DeviceLinkState, type ParticipantMergeView } from "@/lib/participant-linking";
import { sessionIdentityApi } from "./session-api";

const statusText = { waiting: "Oczekuje na drugie urządzenie", waiting_approval: "Wpisz kod z drugiego urządzenia", approved: "Potwierdzone — zakończ na drugim urządzeniu", used: "Urządzenie połączone", expired: "Zaproszenie wygasło", cancelled: "Zaproszenie anulowane" };

export function ParticipantIdentityDialog({ sessionToken, authenticated }: { sessionToken: string; authenticated: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DeviceLinkState | null>(null);
  const [invitation, setInvitation] = useState("");
  const [issuedToken, setIssuedToken] = useState("");
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [proposals, setProposals] = useState<ParticipantMergeView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setState(await sessionIdentityApi<DeviceLinkState>(sessionToken, "linking"));
    if (authenticated) setProposals((await sessionIdentityApi<{ items: ParticipantMergeView[] }>(sessionToken, "merges")).items);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null); setMessage(null);
    try { await action(); } catch (caught) { setError(participantLinkingError(caught)); }
    finally { setBusy(false); }
  }
  async function mutateLink(body: Record<string, unknown>) {
    await sessionIdentityApi(sessionToken, "linking", body);
    await refresh();
  }
  const received = state?.received;
  const renderInvitation = (link: DeviceLink) => <section key={link.id} className="grid gap-2 rounded-lg border p-3" aria-label="Zaproszenie urządzenia">
    <p className="text-sm" role="status">{statusText[link.status]}</p>
    <p className="text-xs text-muted-foreground">Ważne do {new Date(link.expiresAt).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}.</p>
    {link.status === "waiting_approval" ? <form className="grid gap-2" onSubmit={event => { event.preventDefault(); void run(async () => { await mutateLink({ action: "approve", id: link.id, code: codes[link.id] ?? "" }); setCodes({}); setMessage("Potwierdzono. Zakończ łączenie na drugim urządzeniu."); }); }}>
      <Label htmlFor={`approval-${link.id}`}>Kod potwierdzenia z drugiego urządzenia</Label><Input id={`approval-${link.id}`} value={codes[link.id] ?? ""} onChange={event => setCodes({ ...codes, [link.id]: event.target.value })} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="off" required disabled={busy} />
      <Button disabled={busy} type="submit">Potwierdź to urządzenie</Button>
    </form> : null}
    {["waiting", "waiting_approval", "approved"].includes(link.status) ? <Button variant="outline" disabled={busy} onClick={() => void run(() => mutateLink({ action: "cancel", id: link.id }))}>Anuluj zaproszenie</Button> : null}
  </section>;

  return <Dialog open={open} onOpenChange={value => { if (busy) return; setOpen(value); setError(null); setIssuedToken(""); setInvitation(""); setCodes({}); if (value) void run(refresh); }}>
    <DialogTrigger asChild><Button variant="outline" className="mt-3 w-full" type="button">{authenticated ? "Urządzenia i łączenie profili" : "Połącz istniejące urządzenie"}</Button></DialogTrigger>
    <DialogContent showCloseButton={!busy} onInteractOutside={event => { if (busy) event.preventDefault(); }} className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{authenticated ? "Urządzenia i profile" : "Połącz urządzenie"}</DialogTitle><DialogDescription>Łącz tylko własne urządzenia i profile. Nick nie jest dowodem tożsamości.</DialogDescription></DialogHeader>
      <div className="grid min-w-0 gap-4">
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {message ? <p role="status" className="text-sm">{message}</p> : null}
        {busy ? <p role="status" className="text-sm">Przetwarzanie…</p> : null}
        <Button variant="outline" disabled={busy} onClick={() => void run(refresh)}>Sprawdź stan połączenia</Button>
        {authenticated ? <>
          <p className="text-sm">Otwórz ten sam link wydarzenia na drugim urządzeniu i wybierz „Połącz istniejące urządzenie”. Przepisz jednorazowy kod. Zaproszenie jest ważne 3 minuty.</p>
          <Button disabled={busy} onClick={() => void run(async () => { const result = await sessionIdentityApi<{ token: string }>(sessionToken, "linking", { action: "issue" }); setIssuedToken(result.token); await refresh(); })}>Połącz kolejne urządzenie</Button>
          {issuedToken ? <div className="grid gap-2"><Label htmlFor="device-invitation">Jednorazowy kod urządzenia</Label><Input id="device-invitation" value={issuedToken} readOnly autoComplete="off" spellCheck={false} className="font-mono text-xs" onFocus={event => event.target.select()} /><p className="text-xs text-muted-foreground">Przepisz lub skopiuj kod na własne urządzenie. Po zamknięciu okna kod zostanie ukryty.</p></div> : null}
          {state?.issued.map(renderInvitation)}
          <section className="grid gap-3 border-t pt-4" aria-label="Propozycje łączenia profili"><h3 className="font-semibold">Propozycje operatora</h3>
            {proposals?.length === 0 ? <p className="text-sm">Brak oczekujących propozycji.</p> : proposals?.map(proposal => <div key={proposal.id} className="grid gap-3 rounded-lg border p-3"><ParticipantMergePreview proposal={proposal} />
              <p className="text-sm">Potwierdzam, że oba profile należą do mnie. Operator wykona połączenie po uzyskaniu wymaganych zgód.</p>
              <Button disabled={busy || proposal.stale} onClick={() => void run(async () => { await sessionIdentityApi(sessionToken, "merges", { id: proposal.id, approve: true }); await refresh(); setMessage("Zgoda zapisana. Operator może dokończyć połączenie."); })}>Potwierdzam własność obu profili</Button>
              <Button variant="outline" disabled={busy} onClick={() => void run(async () => { await sessionIdentityApi(sessionToken, "merges", { id: proposal.id, approve: false }); await refresh(); })}>To nie moje profile — odrzuć</Button>
            </div>)}
          </section>
        </> : <>
          <form className="grid gap-2" onSubmit={event => { event.preventDefault(); void run(async () => { const result = await sessionIdentityApi<{ link: DeviceLink }>(sessionToken, "linking", { action: "prepare", token: invitation.trim() }); setState({ issued: [], received: result.link }); setInvitation(""); }); }}>
            <Label htmlFor="device-token">Jednorazowy kod z zaufanego urządzenia</Label><Input id="device-token" type="password" autoComplete="off" spellCheck={false} value={invitation} onChange={event => setInvitation(event.target.value)} disabled={busy} required />
            <Button disabled={busy} type="submit">Przygotuj połączenie</Button>
          </form>
          {received ? <section className="grid gap-3 rounded-lg border p-3" aria-label="Potwierdzenie drugiego urządzenia"><p role="status">{statusText[received.status]}</p>
            <p className="text-sm">Na zaufanym urządzeniu wybierz „Sprawdź stan połączenia” i wpisz ten kod potwierdzenia:</p><output aria-label="Kod potwierdzenia" className="font-mono text-3xl tracking-widest">{received.comparisonCode}</output>
            <Button disabled={busy || ["expired", "cancelled"].includes(received.status)} onClick={() => void run(async () => { await sessionIdentityApi(sessionToken, "linking", { action: "finish", id: received.id }); setMessage("Urządzenie połączone."); setOpen(false); router.refresh(); })}>Zakończ połączenie</Button>
          </section> : null}
        </>}
      </div>
    </DialogContent>
  </Dialog>;
}
