import type { DashboardEventQueueRequestStatus } from "@/lib/dashboard-event-queue";
import type { SongSource } from "./api";
import { OperatorClientError } from "./api";

export type EventParticipantSummary = {
  id: number; displayName: string; joinedAt: string;
  activeCount: number; completedCount: number; hasPerformed: boolean;
  online: boolean; onlineUntil: string | null;
};
export type EventParticipantList = { items: EventParticipantSummary[]; canManage: boolean; realtimeEventId: number; serverNow: string; nextPresenceCheckAt: string | null };
export type EventPresenceSnapshot = Pick<EventParticipantList, "serverNow" | "nextPresenceCheckAt"> & {
  items: Pick<EventParticipantSummary, "id" | "online" | "onlineUntil">[];
};
export type EventParticipantDetail = {
  participant: { id: number; displayName: string; joinedAt: string };
  requests: {
    id: number; title: string; artist: string; status: DashboardEventQueueRequestStatus;
    requestedBy: "operator" | "public"; createdAt: string; startedAt: string | null; completedAt: string | null;
  }[];
};
export type ParticipantCatalogSong = { id: number; title: string; artist: string; source: SongSource };

export function participantApiPath(organizationId: string, eventId: string) {
  return `/api/dashboard/organizations/${encodeURIComponent(organizationId)}/events/${encodeURIComponent(eventId)}/participants`;
}

export async function participantApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init, cache: "no-store", credentials: "same-origin",
    headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (!response.ok) {
    const body: { error?: { code?: string } } | null = await response.json().catch(() => null);
    throw new OperatorClientError(response.status, body?.error?.code ?? "REQUEST_FAILED", "Participant request failed.");
  }
  return response.json();
}

export function participantErrorMessage(error: unknown) {
  if (error instanceof OperatorClientError) {
    switch (error.code) {
      case "SESSION_REQUEST_LIMIT_REACHED": return "Ta osoba ma już 2 aktywne zgłoszenia. Poczekaj na zwolnienie miejsca.";
      case "QUEUE_ACTIVE_DUPLICATE": return "Ta osoba ma już aktywne zgłoszenie tej piosenki.";
      case "SESSION_NICKNAME_TAKEN": return "Ten nick jest już zajęty w wydarzeniu. Wybierz istniejącą osobę albo podaj inny nick.";
      case "EVENT_PARTICIPANT_NOT_FOUND": return "Nie znaleziono uczestnika w tym wydarzeniu.";
      case "SONG_NOT_FOUND": return "Nie znaleziono utworu w katalogu. Wyszukaj go ponownie.";
      case "WORKSPACE_EVENT_QUEUE_MANAGE_FORBIDDEN": return "Nie masz uprawnień do tej operacji.";
      case "EVENT_QUEUE_CLOSED": return "Zmiany są dostępne tylko podczas aktywnego wydarzenia.";
      case "EVENT_SESSION_REQUIRED": return "Wydarzenie nie ma sesji uczestników.";
      case "EVENT_NOT_FOUND": return "Nie masz dostępu do tego wydarzenia.";
      case "VALIDATION_ERROR": return "Sprawdź nick (2–24 znaki) i wybrany utwór.";
    }
    if (error.status === 401 || error.status === 403) return "Sesja wygasła lub nie masz dostępu. Odśwież stronę i zaloguj się ponownie.";
  }
  return "Nie udało się pobrać lub zapisać danych. Spróbuj ponownie.";
}
