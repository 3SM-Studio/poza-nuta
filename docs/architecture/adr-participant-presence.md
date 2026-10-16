# Participant Presence: API leases w PostgreSQL 17

Decyzja Slice 3, 2026-10-16. Jeden model tożsamości:
participantIdentity → eventParticipant → songRequests. Presence jest osobną
warstwą połączeń, nie dowodem identity i nie historią występów.

| Opcja | Ocena |
| --- | --- |
| PostgreSQL leases | Bezpośrednia zgodność z HttpOnly credential, serwerowy TTL, transakcje i testowalne wyścigi; wymaga zapisu heartbeat i odpytywania konkretnego deadline'u |
| Supabase Presence track/untrack | Dobre dla klientów z właściwą tożsamością kanału; obecni uczestnicy nie mają Supabase Auth JWT. Stan track pochodzi od klienta, a lifecycle WebSocket nie zastępuje wymaganej semantyki credential/40 s TTL |
| Oba jako źródła danych | Dwa modele wygaśnięcia i reconnect; trudniejsza autoryzacja i uzgadnianie. Niepotrzebne w tym zakresie |

Wybrano **PostgreSQL jako jedyne źródło prawdy**, Realtime wyłącznie do
prywatnej invalidacji. Nie dodajemy JWT uczestników ani direct table reads.
Stateless Next/Vercel może obsłużyć kolejne heartbeat na dowolnej instancji.
Restart aplikacji nie usuwa leases; bez heartbeat wygasają po 40 s.

Karta losuje UUIDv4 w pamięci efektu persistent layout. Connect wiąże go
wyłącznie z membership wyprowadzonym przez serwer z hasha ważnego credential.
Heartbeat co 15 s aktualizuje istniejący rekord, najczęściej co najmniej 5 s
od poprzedniego zapisu. Disconnect jest idempotentnym tombstone, również gdy
beacon wyprzedzi connect. Reconnect po pagehide ma nowy UUID; stary disconnect
nie dotyka nowej karty. Żaden token ani connectionId nie trafia do storage.

Autoryzacja używa lifecycle gate wydarzenia, credential SHARE i niezależnych
advisory locks credential → membership. Nie pobiera mutexu event_sessions
ani locka historii/kolejki. Te same operacje dla jednej osoby są serializowane;
różni uczestnicy działają równolegle. Credential jest ponownie sprawdzany
zegarem bazy po oczekiwaniu. Zamknięte wydarzenie odrzuca mutacje.

Online oznacza co najmniej jedną niewygasłą lease z ważnym, niecofniętym
credential tej samej identity, przy aktywnym wydarzeniu. OnlineUntil to max
połączeń z min(lease expiry, credential expiry, event auto-close). Backend
wykonuje jedną agregację dla całego wydarzenia, bez N+1. Ręczny uczestnik bez
połączeń jest offline, niezależnie od zgłoszeń.

Connect/disconnect wysyła sygnał tylko przy zmianie online albo skróceniu
deadline'u przez zamknięcie jednej z kart. Przedłużenia heartbeat są ciche.
Revocation, zmiana expiry i usunięcie credential invalidują właściwe wydarzenia.
Kanał z 0028 i RBAC pozostają bez zmian. Payload to tylko eventId/type/
operation/changedAt, private=true. Publiczny klient nie subskrybuje listy osób.

Operator otrzymuje serverNow i najbliższy onlineUntil. Jednorazowy timer
zleca ponowny odczyt **snapshotu obecności**, nie całej listy/historii/kolejki.
Timer sam nie zmienia stanu na offline. Przedłużona lease zwraca kolejny
deadline, brak online usuwa timer. Błąd daje stan „sprawdzanie” i retry,
zamiast uznawać lokalny zegar za dowód. Focus, foreground i reconnect
odświeżają dane; brak stałego pollingu. Utrata pojedynczej invalidacji jest
naprawiana przy najbliższym deadline, focus lub ponownym subscribe. Gdy nie ma
żadnego znanego online, obowiązuje focus/reconnect, bez background list pollingu.

Retencja i rollback: runbook 0029. Koszt operacyjny to bounded transakcje
heartbeat i deadline snapshots; bez nowego serwisu lub zaplanowanego workera.
Limity nowych ID są wspólne w DB, ingress limit w pamięci jest defense in depth;
rozproszona ochrona HTTP wymaga istniejącej warstwy WAF, niezmienianej lokalnie.
Wiele ważnych credentials jednej identity jest agregowane, ale ich wydawanie,
verified linking i merge pozostają Slice 4.

Źródła dokumentacji: [Supabase Presence](https://supabase.com/docs/guides/realtime/presence),
[Realtime authorization](https://supabase.com/docs/guides/realtime/authorization),
[server broadcast](https://supabase.com/docs/guides/realtime/broadcast).
