# Participant Model: Slice 1, limit aktywnych zgłoszeń

## Źródła i kontrakt wykonania

Audyt lokalnego repozytorium `C:/Projects/pozanuta-stage-1`, `origin`:
`https://github.com/3SM-Studio/poza-nuta.git`, branch
`fix/song-details-drawer-desktop-position`, HEAD
`9d1fd059c33c28d5679d4ba40037c3897285bb9d`.
Początkowy stan Git: tylko zmodyfikowany `.codex/config.toml`, zachowany bez edycji.
HEAD jest identyczny z historycznym punktem odniesienia podanym w zadaniu.
Nie sprawdzano zdalnego main ani nie wykonywano fetch.

Odczytano `AGENTS.md`, projektowe skille architektury, backendu, frontendu,
Realtime, bezpieczeństwa, testów, Supabase/Auth/RBAC i next-dev-loop.
Przy końcowym review blokad odczytano także supabase-postgres-best-practices
z referencjami krótkich transakcji i spójnej kolejności locków.
Wymagany `codex-prompt-strategist` znaleziono w
`C:/Projects/pozanuta-social/.agents/skills/codex-prompt-strategist/`;
odczytano SKILL.md i wszystkie cztery wskazane referencje.
Nie zmieniano modelu ani nie delegowano pracy.

DONE: lokalna implementacja limitu 2/2, testy negatywne i współbieżności,
polski licznik i błędy, synchronizacja przez istniejącą invalidację Realtime,
pełne wymagane checks oraz handoff. Bez implementacji pozostałych slice'ów.
Brak zgody na commit, push, merge, deploy i operacje na zdalnych bazach.

## Macierz audytu całego modelu

| Wymaganie | Stan zastany | Luka | Slice | Dowód w repozytorium |
| --- | --- | --- | --- | --- |
| Trwała tożsamość, credentials, uczestnictwo | Trzy oddzielne tabele, uczestnik może dołączyć bez zgłoszenia; tożsamość może mieć wiele credentials | Brak produktu do wydawania credentials na kolejne urządzenie | Zachować; linking później | `src/db/schema.ts`: participantIdentities, participantCredentials, eventParticipants; migracja 0023; `session-api/service.ts`: joinPublicSession |
| Nick jako etykieta | Membership oparty na hashu credential i ID; rename zmienia etykietę, zgłoszenia zachowują FK i historyczną nazwę | Nick jest unikalny w sesji, nie stanowi dowodu tożsamości | Zachować | `session-api/service.ts`: requireParticipantMembership, renamePublicSessionParticipant, createPublicSessionRequest |
| Bezpieczne sesje | Losowy credential, SHA-256 w bazie; cookie HttpOnly, SameSite, Secure w produkcji; ochrona origin | Brak one-time linking i merge | Zachować | `session-api/participant-credential.ts`, `session-api/http.ts`, `api/s/[token]/join/route.ts`, test participantIdentity |
| Historia i pierwszy występ | Własne zgłoszenia obejmują historię i są powiązane przez eventParticipantId | Brak wskaźnika pierwszego występu i zbiorczego panelu uczestników | Participant management | `schema.ts`: songRequests; `service.ts`: getPublicParticipantRequests; `operator-api/event-queue.ts` |
| Ręczny uczestnik bez credential | Identity może istnieć bez credential; stare ręczne zgłoszenia mogą mieć null eventParticipantId | Brak przepływu tworzenia pełnego uczestnika przez operatora | Participant management | `schema.ts`: FK eventParticipants.participantId NOT NULL, songRequests.eventParticipantId nullable; brak odpowiednich tras w src/app |
| Presence | Brak modelu połączeń uczestników | connectionId na kartę, heartbeat, TTL, agregacja | Presence | `schema.ts`, trasy `src/app`, brak serwisu presence w `src/server` |
| Linking i merge | Zwykłe kody dostępu wydarzenia i credentials uczestnika już istnieją | Nie są jednorazowym dowodem do łączenia tożsamości; brak replay guard i merge | Linking/merge | `schema.ts`: eventSessionCodes i eventAccessLinks; `src/server/session-api` |
| Fair Queue | Operator akceptuje, rozpoczyna, kończy, przywraca i ręcznie przestawia; now jest wyłączone z reorder; wersjonowanie i mutex | Brak liczenia rund i akcji sprawiedliwego sortowania | Fair Queue | `operator-api/event-queue.ts`; `lib/dashboard-event-queue.ts`; `lib/dashboard-event-queue-optimistic.ts` |
| Limit 2/2 | Aktywne statusy i ochrona duplikatu piosenki, brak limitu liczby | Limit przy create oraz inactive → active, licznik UI | Slice 1, wykonany | `lib/participant-request-policy.ts`, `server/participant-request-limit.ts`, obie ścieżki mutacji |
| Realtime | Publiczny i dashboardowy broadcast jako invalidacja; API zwraca dane; refetch po subskrypcji/reconnect/focus i fallback po mutacji | Licznik nie był prezentowany | Slice 1 wykorzystuje istniejący mechanizm | `public/use-public-queue-realtime.ts`, `realtime/use-queue-realtime.ts`, `session-request-page.tsx`, migracje 0022/0023 |
| Operator participant management | RBAC organizacji i audyt operacji kolejki istnieją | Lista uczestników, statystyki, dodawanie za uczestnika, linking/merge | Participant management i linking/merge | `operator-api/event-queue.ts`: requireEventQueueManagerContext, operatorAuditLog; `src/app` |
| External songs | Katalog ma source=manual, request ma operator source i actor | Brak event_external_songs i obsługi URL YouTube | Manual/external songs | `schema.ts`: songs, songRequests; brak odpowiedniego serwisu/trasy |
| Co-singers | Pojedynczy eventParticipantId na request | Brak relacji współwykonawców i semantyki historii duetów | Co-singers | `schema.ts`: songRequests |
| Autoapproval | Publiczny insert zawsze pending | Brak konfiguracji autoapproval; pozostaje wyłączona | Po Fair Queue, osobna decyzja | `session-api/service.ts`: createPublicSessionRequest |

Dokument AGENTS.md opisuje część wdrożonych funkcji jako planowane.
Ponadto migracja 0022 już obsługuje wiele aktywnych publicznych wydarzeń,
podczas gdy AGENTS.md nadal opisuje invariant pojedynczego wydarzenia.
Slice 1 nie zmienia liczby aktywnych wydarzeń ani ich semantyki.
Rozbieżność dokumentacji wymaga odrębnego uzgodnienia przed zmianami domeny.

## Implementacja i bezpieczeństwo

- Jedna definicja statusów `pending`, `approved`, `now` i stała limitu 2
  w `src/lib/participant-request-policy.ts`. Stare eksporty public queue-policy
  są aliasami zachowującymi dotychczasowych konsumentów.
- `requireParticipantRequestCapacity` liczy aktywne rekordy po eventId i
  eventParticipantId. Nie używa nicku ani liczby zgłoszeń historycznych.
  Sprawdzenie i zapis są w tej samej transakcji po istniejącym
  `event_sessions FOR NO KEY UPDATE`. Public create oraz operator action
  używają tego samego mutexu; domyślna izolacja READ COMMITTED daje nowy
  snapshot dla zapytania liczącego po uzyskaniu locka.
- Reaktywacja rejected → approved oraz done/skipped/rejected → pending
  sprawdza limit. Aktywne → aktywne nie zużywa nowego miejsca.
  Rekordy operatora z eventParticipantId też podlegają kontroli.
- Duplikat aktywnej piosenki zachowuje dotychczasowy błąd i ma pierwszeństwo
  przed kontrolą liczby przy public create. Limit zwraca 409 i stabilny kod
  `SESSION_REQUEST_LIMIT_REACHED` przez dotychczasowe adaptery błędów API.
- Done, rejected i skipped nie zajmują miejsca. Cancel uczestnika nadal
  dotyczy tylko własnego pending. Historia nie jest usuwana.
- UI pokazuje aktywne 0/2, 1/2, 2/2 niezależnie od historii, w głównym widoku
  oraz Moich zgłoszeniach. Błąd limitu odświeża stan kanoniczny. Operator
  wycofuje optymistyczną zmianę i pobiera aktualną kolejkę. Tło Realtime
  zachowuje komunikat odmowy do kolejnej akcji lub jawnego odświeżenia;
  smoke ujawnił i pokryto regresją wcześniejsze znikanie tego komunikatu.
- Zachowane: RBAC, origin checks, katalogowy songId, HttpOnly cookies,
  hashowane credentials, audyt udanych działań operatora i minimalne
  broadcasty. Nie dodano pollingu ani publicznej ekspozycji participant ID.

Nie dodano migracji. Istniejące rekordy ponad 2/2 nie są automatycznie
anulowane. Kontrola blokuje nowe aktywacje do czasu zwolnienia miejsc.
Bezpośredni administracyjny SQL pozostaje poza gwarancją aplikacyjnego guarda.
Przyszłe inserty operatora/importy/linking/merge muszą respektować ten sam
kontrakt transakcji i pojemności. Rekord bez eventParticipantId nie ma
wiarygodnej tożsamości; jego przypisanie wymaga przyszłego slice'a.

## Weryfikacja

| Komenda | Wynik |
| --- | --- |
| `pnpm test` | PASS: Node 369/369, Vitest 546/546, 45 plików; bez skipów |
| `pnpm typecheck` | PASS, również po zmianie fixture E2E |
| `pnpm lint` | PASS |
| `pnpm build` | PASS, Next.js 16.3.0/Turbopack |
| `git diff --check` | PASS |
| `pnpm exec vitest run --config vitest.public-session-postgres.config.ts tests/postgres/participantIdentity.integration.test.ts --silent` | PASS: 4/4, Postgres 15 i 17; dotychczasowe identity/ownership oraz nowe scenariusze limitu |
| `$env:LOCAL_E2E_PLAYWRIGHT_GREP='2/2'; pnpm test:e2e:public-event-session-identity-local` | PASS: 1/1, rzeczywista przeglądarka, lokalny Supabase Auth/Realtime/Postgres 17; aktualizacja po odrzuceniu 1613 ms (limit 5 s) |

Nowe testy Postgres obejmują pierwszy/drugi/trzeci request, duplikat,
dwa równoczesne różne utwory przy 1/2, trzy przy 0/2, now jako aktywny,
done/rejected/skipped jako zwolnienie miejsca, odmowę restore i approve
przy 2/2, rename, rozdzielenie tożsamości i wydarzeń, HTTP 409, wyścig
restore/create i brak obejścia przez operator source z participant ID.
Testy komponentowe obejmują licznik, historię, invalidację Realtime,
ponowne zamontowanie, błędy limitu, rollback optymistycznego restore
i zachowanie komunikatu odmowy po kolejnym broadcastzie.
Testy wyścigów używają zewnętrznego locka sesji jako bariery; przed
zwolnieniem sprawdzają w pg_stat_activity dwie aplikacyjne transakcje
jednocześnie czekające na mutex. Końcowe 4/4 przeszło również z tą barierą.

Pierwsze próby weryfikacji wykryły i usunięto: błędną ścieżkę importu
resetu rate-limit w nowym teście oraz niejednoznaczny selektor licznika.
Końcowy `pnpm test` i testy Postgres przeszły po poprawkach.
Pierwszy smoke nie znalazł testów z wielowyrazowym filtrem; użyto `2/2`.
Kolejna próba ujawniła zastany generator 8-cyfrowych kodów w lokalnej
fixture E2E. Zmieniono wyłącznie fixture na 6 cyfr, zgodnie z migracją 0027.
Migracje repozytorium na izolowanym lokalnym Supabase przeszły poprawnie.
W nowym smoke poprawiono również brak potwierdzenia dialogu odrzucenia
(dodano open/cancel przed potwierdzeniem) oraz selektor kolidujący z Next
route announcer. Oczekiwane 409 są sprawdzane wraz z kodem błędu na obu
endpointach; obserwator błędów przeglądarki wyklucza tylko te wskazane
ścieżki i standardowy komunikat zasobu 409, nadal wykrywając pozostałe błędy.
Jedno równoległe uruchomienie typecheck/build dało TS6053 dla odtwarzanych
`.next/types`; typecheck powtórzony po zakończeniu builda przeszedł.
Końcowy smoke przeszedł. Potwierdził 0/2 → 1/2 → 2/2, reload bez utraty
licznika, odmowę trzeciej piosenki przez bezpośredni HTTP i UI, open/cancel
dialogu odrzucenia, zmianę 2/2 → 1/2 przez realny broadcast (1613 ms),
ponowne zgłoszenie oraz HTTP 409 i komunikat operatora przy restore.
Nie uruchamiano całej wieloscenariuszowej suite E2E, tylko smoke Slice 1.
Produkcja i zdalny Supabase: NOT VERIFIED, poza autoryzowanym zakresem.

Next DevTools MCP: wykryto serwery i trasy, `get_compilation_issues`
oraz `get_errors` bez błędów na 3000 i na testowym 3105. Agent-browser
0.35.1: preflight, strona publiczna, snapshot i React tree. Funkcjonalne
sprawdzenie zmienionego przepływu jest wykonywane przez Playwright.

Nie użyto GitHub, Vercel, Cloudflare ani zdalnego Supabase MCP.
Narzędzia: lokalny shell/pnpm, Docker/Postgres 15 i 17, istniejący runner
lokalnego Supabase CLI 2.109.1 (Auth/Realtime/Postgres 17), Playwright,
agent-browser i Next DevTools MCP. Docker Desktop został uruchomiony;
testy tworzą i sprzątają wyłącznie własne izolowane zasoby.
Plików `.env` nie zmieniono. Nie dodano ani nie uruchomiono nowej migracji;
istniejące migracje zastosowano wyłącznie w izolowanych bazach testowych.
Brak commita, push, merge i deploy.

## Pliki zmienione w Slice 1

- `src/lib/participant-request-policy.ts` (nowy): wspólny kontrakt statusów i 2/2.
- `src/server/participant-request-limit.ts` (nowy): autorytatywny guard.
- `src/server/public-api/queue-policy.ts`: aliasy wspólnej polityki.
- `src/server/session-api/service.ts`: guard przed publicznym insertem.
- `src/server/operator-api/event-queue.ts`: guard reaktywacji.
- `src/components/public/session-request-page.tsx`: licznik i błąd limitu.
- `src/components/public/session-participant-requests.tsx`: licznik przy historii.
- `src/components/public/session-state-alert.tsx`: polski komunikat 2/2.
- `src/components/operator/event-queue-panel.tsx`: błąd, rollback i refetch.
- `tests/postgres/participantIdentity.integration.test.ts`: realne transakcje i HTTP.
- `tests/vitest/session-request-feedback.component.test.tsx`: licznik i synchronizacja.
- `tests/vitest/session-state-alert.component.test.tsx`: prezentacja odmowy.
- `tests/vitest/event-queue-panel.component.test.tsx`: rollback restore.
- `tests/e2e/public-event-session-identity.local.spec.ts`: smoke 2/2 i Realtime.
- `tests/e2e/local-supabase-fixture.ts`: zgodność kodów sesji z migracją 0027.
- `docs/features/participant-model-slice-1.md` (nowy): audyt i handoff.

Bez zmian w schema, migracjach, local env, `data`, route handlers i auth flow.
`.codex/config.toml` pozostaje początkową zmianą użytkownika.

## Następne slice'y, kolejność i bramki

1. Participant management: endpointy i UI listy uczestników z RBAC, liczbą
   aktywnych requestów i występów; pierwszy występ = brak wcześniejszego now
   lub done w tym wydarzeniu. Ręczne tworzenie identity + eventParticipant
   bez credential i dodawanie piosenki przez wspólny guard 2/2. Negatywne
   testy uprawnień i cross-workspace; brak przypisywania historii po nicku.
2. Presence: osobna relacja połączeń connectionId/karta, heartbeat około 15 s,
   TTL 35–45 s, best-effort pagehide/sendBeacon; agregacja po uczestniku.
   Test zamknięcia jednej z dwóch kart i wielu urządzeń; bez fingerprintingu.
3. Linking/merge: krótkotrwały jednorazowy dowód, hashowany kod, atomowe
   wykorzystanie i replay guard. Operator zatwierdza merge, audit i idempotencja;
   transakcja zachowuje credentials/historię/requesty. Jawnie rozstrzygnąć
   limit 2/2 po merge i konflikty aktywnych duplikatów przed implementacją.
4. Fair Queue: najpierw ADR semantyki completed/now/cofnięć/manual override
   oraz zero-based queuedSongOrdinal. Dopiero potem czysta deterministyczna
   funkcja, tie-breakery i soft rule kolejnych występów, transactional approve
   oraz osobne „Ułóż sprawiedliwie”. Now nieruchome; testy matematyczne i wyścigi.
5. Manual/external songs: zweryfikować model event_external_songs i URL/provider,
   event scoping, operator source/actor/audit, wspólny Fair Queue i 2/2.
   Publiczne zgłoszenia nadal wyłącznie przez katalog; migracja z runbookiem.
6. Co-singers: relacja znanych uczestników, fallback manual bez domniemania
   tożsamości. Uzgodnić naliczanie duetu do historii, rund i limitu 2/2;
   testy zmiany składu i współbieżnych akcji.
7. Final E2E i readiness audit: pełne ścieżki uczestnik/operator, wiele kart
   i urządzeń, reconnect i utrata sieci, negatywne RBAC, real Postgres,
   smoke Realtime, review migracji/rollbacków i dokumentacji.
   Autoapproval pozostaje wyłączona do osobnej decyzji po Fair Queue.

Kontynuacja: przeczytać aktualny Git/diff, ten handoff i implementację.
Nie zakładać PASS dla produkcji ani aktualności zdalnego main. Nie zmieniać
`.codex/config.toml`; nie commitować ani nie wykonywać zdalnych mutacji.

## Werdykt

**PASS dla lokalnego Slice 1.** Wymagane checks, realne transakcje Postgres
i ukierunkowany browser smoke zakończyły się powodzeniem po opisanych
poprawkach. Brak znanego blokera lub zmiany granic auth/RBAC w tym slice.
Pełny program Participant Model & Fair Queue pozostaje planem kolejnych
slice'ów, a dopuszczenie produkcyjne wymaga osobnej autoryzacji i weryfikacji.
