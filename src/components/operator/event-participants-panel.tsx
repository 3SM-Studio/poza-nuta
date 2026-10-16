"use client";

import { useUiText } from "@/i18n/use-ui-text";
import { canSearchPublicSongs } from "@/components/public/validation";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { RequestStatusBadge } from "@/components/request-status-badge";
import { ParticipantMergePanel } from "./participant-merge-panel";
import { useQueueRealtime } from "@/components/realtime/use-queue-realtime";
import { PARTICIPANT_ACTIVE_REQUEST_LIMIT } from "@/lib/participant-request-policy";
import { getDashboardOrganizationEventQueuePath } from "@/lib/dashboard-routes";
import {
  participantApi, participantApiPath, participantErrorMessage,
  type EventParticipantDetail, type EventParticipantList, type ParticipantCatalogSong, type EventPresenceSnapshot,
} from "./event-participants-api";

export function EventParticipantsPanel({ organizationId, eventId, initialData }: {
  organizationId: string; eventId: string; initialData: EventParticipantList;
}) {
  const tx = useUiText();

  const base = participantApiPath(organizationId, eventId);
  const [data, setData] = useState(initialData);
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  const [detail, setDetail] = useState<EventParticipantDetail | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [nickname, setNickname] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [songs, setSongs] = useState<ParticipantCatalogSong[] | null>(null);
  const [selectedSongId, setSelectedSongId] = useState<number | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const generation = useRef(0);
  const searchGeneration = useRef(0);
  const [presenceStale, setPresenceStale] = useState(false);
  const presenceGeneration = useRef(0);
  const presenceServerTime = useRef(Date.parse(initialData.serverNow));

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const version = ++generation.current;
    const participantId = selectedIdRef.current;
    try {
      const [list, nextDetail] = await Promise.all([
        participantApi<EventParticipantList>(base, { signal }),
        participantId === null ? Promise.resolve(null) : participantApi<EventParticipantDetail>(`${base}/${participantId}`, { signal }),
      ]);
      if (signal?.aborted || generation.current !== version) return;
      if (Date.parse(list.serverNow) < presenceServerTime.current) return;
      presenceServerTime.current = Date.parse(list.serverNow);
      setData(list);
      presenceGeneration.current += 1;
      setPresenceStale(false);
      setDetail(nextDetail);
      setRefreshError(null);
    } catch (error) {
      if (!signal?.aborted && generation.current === version) setRefreshError(participantErrorMessage(error));
    } finally {
      if (!signal?.aborted && generation.current === version) setIsRefreshing(false);
    }
  }, [base]);

  useEffect(() => {
    const controller = new AbortController();
    const onFocus = () => void refresh(controller.signal);
    window.addEventListener("focus", onFocus);
    return () => { generation.current += 1; controller.abort(); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const deadline = data.nextPresenceCheckAt;
    async function checkExpiry() {
      const version = ++presenceGeneration.current;
      setPresenceStale(true);
      try {
        const snapshot = await participantApi<EventPresenceSnapshot>(`${base}/presence`, { signal: controller.signal });
        if (!active || version !== presenceGeneration.current) return;
        if (Date.parse(snapshot.serverNow) < presenceServerTime.current) return;
        presenceServerTime.current = Date.parse(snapshot.serverNow);
        const byId = new Map(snapshot.items.map(item => [item.id, item]));
        setData(current => ({ ...current, serverNow: snapshot.serverNow, nextPresenceCheckAt: snapshot.nextPresenceCheckAt,
          items: current.items.map(item => ({ ...item, ...(byId.get(item.id) ?? { online: false, onlineUntil: null }) })) }));
        setPresenceStale(false); setRefreshError(null);
      } catch (error) {
        if (!active || version !== presenceGeneration.current) return;
        setRefreshError(participantErrorMessage(error));
        // Error retry only. Healthy snapshots schedule exactly their next lease
        // deadline; no interval polling of participants, history or queue.
        timer = setTimeout(() => void checkExpiry(), 15_000);
      }
    }
    if (deadline) {
      const delay = Math.max(100, Date.parse(deadline) - Date.parse(data.serverNow) + 100);
      timer = setTimeout(() => void checkExpiry(), delay);
    }
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(controller.signal); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; clearTimeout(timer); controller.abort(); document.removeEventListener("visibilitychange", onVisible); };
  }, [base, data.serverNow, data.nextPresenceCheckAt, refresh]);

  const invalidate = useCallback(async (_reason: unknown, signal: AbortSignal) => { await refresh(signal); }, [refresh]);
  const connection = useQueueRealtime({ audience: "participants", identity: data.realtimeEventId, onInvalidate: invalidate });
  useQueueRealtime({ audience: "dashboard", identity: data.realtimeEventId, onInvalidate: invalidate });

  const selected = data.items.find((item) => item.id === selectedId);
  const visibleItems = data.items.filter((item) => item.displayName.toLocaleLowerCase("pl").includes(filter.trim().toLocaleLowerCase("pl")));

  function selectParticipant(id: number) {
    generation.current += 1;
    searchGeneration.current += 1;
    selectedIdRef.current = id;
    setSelectedId(id); setDetail(null); setSongs(null); setSelectedSongId(null); setQuery(""); setActionError(null);
    setIsSearching(false);
    void refresh();
  }

  async function createParticipant(event: FormEvent) {
    event.preventDefault();
    if (isCreating) return;
    setIsCreating(true); setCreateError(null);
    try {
      const result = await participantApi<{ participant: { id: number } }>(base, { method: "POST", body: JSON.stringify({ displayName: nickname }) });
      setCreateOpen(false); setNickname(""); setFilter("");
      selectParticipant(result.participant.id);
      toast.success(tx("Dodano uczestnika"));
    } catch (error) { setCreateError(participantErrorMessage(error)); }
    finally { setIsCreating(false); }
  }

  async function searchSongs(event: FormEvent) {
    event.preventDefault();
    if (!canSearchPublicSongs(query)) return;
    const version = ++searchGeneration.current;
    setIsSearching(true); setActionError(null); setSelectedSongId(null);
    try {
      const result = await participantApi<{ items: ParticipantCatalogSong[] }>(`${base}/songs?q=${encodeURIComponent(query)}`);
      if (searchGeneration.current === version) setSongs(result.items);
    } catch (error) { if (searchGeneration.current === version) setActionError(participantErrorMessage(error)); }
    finally { if (searchGeneration.current === version) setIsSearching(false); }
  }

  async function addSong() {
    if (isAdding || selectedId === null || selectedSongId === null) return;
    setIsAdding(true); setActionError(null);
    try {
      await participantApi(`${base}/${selectedId}/requests`, { method: "POST", body: JSON.stringify({ songId: selectedSongId }) });
      toast.success(tx("Dodano zgłoszenie w imieniu uczestnika"), { description: tx("Zgłoszenie czeka na zatwierdzenie w kolejce.") });
      setSelectedSongId(null);
    } catch (error) { setActionError(participantErrorMessage(error)); }
    finally { setIsAdding(false); await refresh(); }
  }

  return (
    <section className="flex flex-col gap-5" aria-labelledby="event-participants-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="event-participants-title" className="text-xl font-semibold">{tx("Uczestnicy wydarzenia")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{tx("Osoby, które dołączyły do wydarzenia, także bez zgłoszonej piosenki.")}</p></div>
        <div className="flex flex-wrap gap-2">
          {data.canManage ? <ParticipantMergePanel base={base} participants={data.items} onCompleted={async id => { selectedIdRef.current = id; setSelectedId(id); await refresh(); }} /> : null}
          <Button variant="outline" disabled={isRefreshing} onClick={() => { setIsRefreshing(true); void refresh(); }}>{isRefreshing ? tx("Odświeżanie…") : tx("Odśwież uczestników")}</Button>
          {data.canManage ? <Dialog open={createOpen} onOpenChange={(open) => { if (!isCreating) { setCreateOpen(open); setCreateError(null); } }}>
            <DialogTrigger asChild><Button disabled={isAdding}>{tx("Dodaj uczestnika")}</Button></DialogTrigger>
            <DialogContent><DialogHeader><DialogTitle>{tx("Dodaj uczestnika")}</DialogTitle>
              <DialogDescription>{tx("Utwórz osobę bez telefonu. Nick nie łączy jej z żadną inną tożsamością.")}</DialogDescription></DialogHeader>
              <form onSubmit={(event) => void createParticipant(event)} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2"><Label htmlFor="manual-participant-name">{tx("Nick uczestnika")}</Label>
                  <Input id="manual-participant-name" value={nickname} onChange={(event) => setNickname(event.target.value)} minLength={2} maxLength={24} required disabled={isCreating} aria-invalid={!!createError} /></div>
                {createError ? <Alert variant="destructive"><AlertDescription>{tx(createError)}</AlertDescription></Alert> : null}
                <Button disabled={isCreating} type="submit">{isCreating ? tx("Dodawanie…") : tx("Utwórz uczestnika")}</Button>
              </form>
            </DialogContent>
          </Dialog> : null}
        </div>
      </div>
      <p className="text-sm text-muted-foreground" role="status" data-participants-realtime={connection}>
        {connection === "live" ? tx("Aktualizacje uczestników na żywo") : connection === "connecting" ? tx("Łączenie aktualizacji uczestników…") : tx("Połączenie aktualizacji uczestników niedostępne. Ponowne łączenie; możesz odświeżyć listę.")}
      </p>
      <p className="text-sm" role="status">{presenceStale ? tx("Sprawdzanie obecności — ostatni odczyt: ") : tx("Online: ")}{data.items.filter(item => item.online).length} / {data.items.length}</p>
      {refreshError ? <Alert variant="destructive"><AlertTitle>{tx("Nie udało się odświeżyć uczestników")}</AlertTitle><AlertDescription>{tx(refreshError)}</AlertDescription></Alert> : null}
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(15rem,1fr)_minmax(0,2fr)]">
        <Card><CardHeader><CardTitle>{tx("Lista uczestników (")}{data.items.length})</CardTitle><CardDescription>{tx("Wybierz osobę, aby zobaczyć zgłoszenia i dodać utwór.")}</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Label htmlFor="participant-filter">{tx("Szukaj uczestnika")}</Label><Input id="participant-filter" value={filter} onChange={(event) => setFilter(event.target.value)} />
            {visibleItems.length === 0 ? <Empty><EmptyHeader><EmptyTitle>{data.items.length ? tx("Brak pasujących osób") : tx("Jeszcze nie ma uczestników")}</EmptyTitle><EmptyDescription>{tx("Uczestnik pojawi się po dołączeniu przez link lub po ręcznym dodaniu.")}</EmptyDescription></EmptyHeader></Empty> : (
              <ul className="flex flex-col gap-2">{visibleItems.map((item) => <li key={item.id}>
                <Button variant={item.id === selectedId ? "secondary" : "outline"} className="h-auto w-full flex-col items-start gap-1 whitespace-normal py-3 text-left" aria-label={tx("Wybierz uczestnika: {v0}", {v0: item.displayName})} aria-pressed={item.id === selectedId} disabled={isAdding} onClick={() => selectParticipant(item.id)}>
                  <span className="break-all">{item.displayName}</span><span className="text-sm">{tx("Aktywne: ")}{item.activeCount}/{PARTICIPANT_ACTIVE_REQUEST_LIMIT} {tx(" · Zakończone występy: ")}{item.completedCount}</span>
                  <Badge variant={item.online && !presenceStale ? "secondary" : "outline"} data-participant-presence={presenceStale ? "checking" : item.online ? "online" : "offline"}>{presenceStale ? tx("Sprawdzanie obecności…") : item.online ? tx("Online") : tx("Offline")}</Badge>
                  {!item.hasPerformed ? <Badge variant="outline">{tx("Jeszcze nie śpiewał(a)")}</Badge> : null}
                </Button>
              </li>)}</ul>
            )}
          </CardContent></Card>
        <Card><CardHeader><CardTitle>{selected?.displayName ?? tx("Szczegóły uczestnika")}</CardTitle>
          <CardDescription>{selected ? tx("Aktywne zgłoszenia: {v0}/2 · Zakończone występy: {v1}", {v0: selected.activeCount, v1: selected.completedCount}) : tx("Wybierz uczestnika z listy.")}</CardDescription></CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-5">
            {selectedId !== null && detail === null ? <div role="status" aria-label={tx("Wczytywanie historii uczestnika")}><Skeleton className="h-20 w-full" /></div> : null}
            {selected && data.canManage ? <section aria-labelledby="participant-add-song"><h3 id="participant-add-song" className="font-semibold">{tx("Dodaj piosenkę dla: ")}{selected.displayName}</h3>
              <form onSubmit={(event) => void searchSongs(event)} className="mt-3 flex flex-col gap-3">
                <Label htmlFor="participant-song-query">{tx("Tytuł lub wykonawca")}</Label><Input dir="auto" id="participant-song-query" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedSongId(null); setSongs(null); searchGeneration.current += 1; setIsSearching(false); }} maxLength={100} disabled={isAdding} />
                <Button type="submit" variant="outline" disabled={isSearching || isAdding || !canSearchPublicSongs(query)}>{isSearching ? tx("Wyszukiwanie…") : tx("Szukaj w katalogu")}</Button>
              </form>
              {songs?.length === 0 ? <p className="mt-3 text-sm" role="status">{tx("Brak utworów. Spróbuj innego tytułu lub wykonawcy.")}</p> : null}
              {songs && songs.length > 0 ? <fieldset className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto"><legend className="mb-2 text-sm font-medium">{tx("Wybierz utwór z katalogu")}</legend>{songs.map((song) => <label key={song.id} className="flex items-start gap-3 rounded-md border p-3 text-sm"><input type="radio" name="participant-catalog-song" value={song.id} checked={selectedSongId === song.id} onChange={() => setSelectedSongId(song.id)} disabled={isAdding} /><span dir="auto" className="min-w-0 break-words">{song.title} · {song.artist}</span></label>)}</fieldset> : null}
              <Button className="mt-3" disabled={isAdding || selectedSongId === null} onClick={() => void addSong()}>{isAdding ? tx("Dodawanie…") : tx("Dodaj zgłoszenie")}</Button>
              <p className="mt-2 text-sm text-muted-foreground">{tx("Limit 2 aktywnych zgłoszeń obowiązuje też operatora. Zgłoszenie trafi do oczekujących.")}</p>
            </section> : null}
            {actionError ? <Alert variant="destructive"><AlertTitle>{tx("Nie udało się wykonać operacji")}</AlertTitle><AlertDescription>{tx(actionError)}</AlertDescription></Alert> : null}
            {detail ? <section aria-labelledby="participant-history"><h3 id="participant-history" className="font-semibold">{tx("Zgłoszenia i historia")}</h3>
              <p className="my-2 text-sm text-muted-foreground">{tx("Zakończone występy to zgłoszenia ze statusem „Zagrane”. Cofnięcie do kolejki zmniejsza ten licznik.")}</p>
              {detail.requests.length === 0 ? <p className="text-sm">{tx("Ta osoba nie ma jeszcze zgłoszeń.")}</p> : <ul className="flex flex-col gap-3">{detail.requests.map((request) => <li key={request.id} className="min-w-0 rounded-md border p-3"><RequestStatusBadge status={request.status} /><p className="mt-2 break-words font-medium">{request.title} · {request.artist}</p><p className="mt-1 text-sm text-muted-foreground">{request.requestedBy === "operator" ? tx("Dodane przez operatora") : tx("Dodane przez uczestnika")} · {tx.date(request.createdAt)}</p></li>)}</ul>}
            </section> : null}
            <Button variant="outline" asChild><Link href={getDashboardOrganizationEventQueuePath(organizationId, eventId)}>{tx("Przejdź do kolejki")}</Link></Button>
          </CardContent></Card>
      </div>
    </section>
  );
}
