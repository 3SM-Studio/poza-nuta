export type DeviceLink = {
  id: string; expiresAt: string;
  status: "waiting" | "waiting_approval" | "approved" | "used" | "expired" | "cancelled";
  comparisonCode?: string;
};
export type DeviceLinkState = { issued: DeviceLink[]; received: DeviceLink | null };
export type ParticipantMergeView = {
  id: string;
  source: MergeProfile; target: MergeProfile;
  sourceConsentRequired: boolean; sourceConsented: boolean; targetConsented: boolean;
  expiresAt: string; completedAt: string | null; cancelledAt: string | null;
  stale: boolean; conflict: "limit" | "duplicate" | null;
};
type MergeProfile = { displayName: string; activeCount: number; requests: {
  id: string; title: string; artist: string; status: "pending" | "approved" | "now" | "done" | "skipped" | "rejected";
  createdAt: string; completedAt: string | null;
}[] };

export function participantLinkingError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : "";
  switch (code) {
    case "SESSION_LINK_CONFIRMATION_MISMATCH": return "Kod potwierdzenia nie pasuje. Sprawdź kod na drugim urządzeniu.";
    case "SESSION_LINK_EXPIRED": return "Kod wygasł. Utwórz nowe zaproszenie na zaufanym urządzeniu.";
    case "SESSION_LINK_USED": case "SESSION_LINK_ALREADY_CLAIMED": return "Zaproszenie zostało już wykorzystane lub przypisane do innego urządzenia.";
    case "SESSION_LINK_APPROVAL_REQUIRED": return "Najpierw potwierdź kod na zaufanym urządzeniu.";
    case "SESSION_LINK_IDENTITY_CONFLICT": return "To urządzenie ma już inną tożsamość. Operator może zaproponować połączenie profili.";
    case "SESSION_DEVICE_ALREADY_LINKED": return "To urządzenie jest już połączone z tą tożsamością.";
    case "SESSION_LINK_INVALID": return "Nieprawidłowe lub anulowane zaproszenie. Sprawdź kod albo utwórz nowe.";
    case "SESSION_RATE_LIMITED": return "Zbyt wiele prób. Spróbuj ponownie za minutę.";
    case "PARTICIPANT_MERGE_LIMIT": return "Po połączeniu byłyby więcej niż 2 aktywne zgłoszenia. Rozwiąż konflikt w kolejce.";
    case "PARTICIPANT_MERGE_DUPLICATE": return "Oba profile mają aktywne zgłoszenie tej samej piosenki. Rozwiąż konflikt w kolejce.";
    case "PARTICIPANT_MERGE_CONSENT_REQUIRED": return "Brakuje ważnego potwierdzenia uczestnika. Odśwież propozycję.";
    case "PARTICIPANT_MERGE_STALE": case "PARTICIPANT_MERGE_EXPIRED": case "PARTICIPANT_MERGE_CANCELLED": return "Propozycja wygasła, została anulowana lub profile się zmieniły. Utwórz nową.";
    case "SESSION_EVENT_CLOSED": case "EVENT_QUEUE_CLOSED": return "Łączenie jest dostępne tylko podczas aktywnego wydarzenia.";
    case "SESSION_PARTICIPANT_REQUIRED": return "Sesja uczestnika wygasła. Odśwież stronę.";
    case "WORKSPACE_EVENT_QUEUE_MANAGE_FORBIDDEN": return "Nie masz uprawnień do łączenia profili.";
  }
  return "Nie udało się wykonać operacji. Sprawdź połączenie i spróbuj ponownie.";
}
