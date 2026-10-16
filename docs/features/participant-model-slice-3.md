# Participant Model, Slice 3: Presence i PostgreSQL 17

## Git, źródła i review gate

Repo `C:/Projects/pozanuta-stage-1`, origin `https://github.com/3SM-Studio/poza-nuta.git`.
Branch `fix/song-details-drawer-desktop-position`, HEAD
`9d1fd059c33c28d5679d4ba40037c3897285bb9d`. Stan początkowy ponownie sprawdzono
przez pwd/remote/branch/HEAD/status oraz rzeczywisty diff i pliki untracked.
Zastano lokalny Slice 1/2 i `.codex/config.toml` użytkownika. Zapisano hashe
początkowych brudnych plików w ignorowanym artefakcie; config i handoffy
Slice 1/2 zachowano bez zmian. Nie użyto reset/clean/stash, commita, push/merge
ani zdalnego GitHub. Techniczna nazwa/branding Poza Nutą pozostają bez zmian.

Odczytano aktualne AGENTS.md, oba handoffy, runbook 0028, schema i journal;
personalny codex-prompt-strategist i wszystkie cztery referencje z sąsiedniego
pozanuta-social (wyłącznie read-only), skille architektury, backendu, DB,
Auth/RBAC, security, Realtime, frontend/shadcn, testów, Supabase/Postgres oraz
next-dev-loop. Lokalne docs Next 16.3: Route Handlers i Server/Client Components.
Context7: Supabase Presence/broadcast/authorization; sprawdzono changelog.
Nie delegowano pracy ani nie zmieniano sąsiedniego projektu.

Review Slice 2: **PASS**. Potwierdzono jedno powiązanie historyczne przez
eventParticipantId, brak łączenia po nickach, nową identity/membership bez
credential przy manual create, RBAC i event scope każdego API, katalogowe
songId/source/actor ustalane przez serwer, wspólny mutex/guard 2/2 i reaktywacje,
czytelność legacy null FK oraz minimalny prywatny payload 0028.
Zastane testy participantIdentity uruchomiono przed Presence już tylko na
Postgres 17: 3/3 PASS. Nie wykryto krytycznej regresji danych lub uprawnień.

## PostgreSQL 17

Jedyna wspierana/testowana wersja: **17**. Wcześniejsze 15/17 pochodziło
z list obrazów w 12 plikach i domyślnego postgres:15-alpine w harnessie;
trzy testy wyszukiwarki wskazywały 15 bezpośrednio. Nie była to potrzeba domeny.
Wszystkie te wejścia wskazują teraz postgres:17-alpine. Harness odrzuca inne
obrazy; scenariusze locków, transakcji, autoryzacji i limitu nie zostały usunięte.
Statyczny test chroni aktywną macierz przed powrotem 15/16/18.

Audyt objął tests/postgres, tests/e2e, load harness, skrypty, dokumentację
i konfigurację repo. Brak wersjonowanego Compose/Dockerfile, CI workflow
i stałego supabase/config.toml w tym checkout. E2E i load harness generują
izolowany config z major_version=17. E2E wykonuje dodatkowo read-only
server_version_num przed migracjami: rzeczywiście **170006**.
README i bieżące wymagania dokumentacji wskazują 17; dawnych raportów wykonania
migracji/testów nie przerabiano na fikcyjne wyniki 17.

Nie uruchomiono testów na 15, 16 ani 18. Wersja produkcji: **NOT VERIFIED**.
Nie było zweryfikowanego autoryzowanego dostępu read-only do produkcji przez
projektowy MCP; nie wykorzystano lokalnego env do omijania tej granicy.
Nie zmieniono produkcji ani konfiguracji sąsiedniego Supabase.

## Architektura i lifecycle

Pełne uzasadnienie i porównanie PostgreSQL/Supabase Presence/kombinacji:
`docs/architecture/adr-participant-presence.md`.

Źródło prawdy to PostgreSQL leases, bez nowego systemu identity:
participantIdentity → eventParticipant → songRequests + participant_connections.
Istniejące HttpOnly credential nie jest Supabase Auth JWT; natywne track/untrack
wymagałoby dodatkowej autoryzacji i innego modelu expiry. API leases pasuje do
Drizzle, wielu instancji Vercel, restartów i kontrolowanych testów transakcji.

- Persistent public session layout montuje jeden efekt Presence na kartę,
  niezależnie od piosenek i nawigacji katalogu. UUIDv4 jest wyłącznie w pamięci.
- Connect przyjmuje tylko connectionId/action. Serwer rozpoznaje membership
  przez hash ważnego credential i konkretny eventSession. Bez client person ID.
- Heartbeat około 15 s, lease 40 s z clock_timestamp bazy. Aktualizuje konkretny
  istniejący connection; zapis jest tłumiony przy odstępie poniżej 5 s.
- Zwykły retry connect jest idempotentny. Heartbeat nigdy nie tworzy rekordów.
- pagehide/sendBeacon best-effort zamyka wyłącznie ten UUID. Disconnect jest
  idempotentnym tombstone, także gdy wyprzedzi connect. Zamkniętego ID nie można
  wskrzesić. Po pagehide/pageshow jest nowy UUID; spóźniony disconnect jest obojętny.
- Błąd sieci/429/5xx ponawia ten sam UUID; offline zatrzymuje próby do online.
  Foreground wznawia heartbeat. Brak lease po retencji/409 powoduje szybki
  connect nowego UUID, a 401/403/404 kończy heartbeat nieważnej sesji.
- Timeout pojedynczego klientowego heartbeat: 8 s. W tle mobilna karta może
  zostać zawieszona; bez komunikacji wygasa po TTL i wraca online po wznowieniu.
- Reload nie usuwa identity, membership ani historii. Wiele ważnych credentials
  tej samej już zweryfikowanej identity jest agregowane, bez implementacji linking.

Online = istnieje co najmniej jedna niewygasła lease z ważnym credential tej
samej identity i przy aktywnym wydarzeniu. Cofnięte/wygasłe credentials oraz
zamknięte/cancelled/automatycznie zakończone wydarzenia nie dają online.
OnlineUntil = max(min(connection expiry, credential expiry, event auto-close)).
Ręczny uczestnik bez connections jest offline. Jedna agregacja całego wydarzenia,
bez N+1 i bez zwracania pełnych connection records.

## Transakcje, bezpieczeństwo i Realtime

POST `/api/s/[token]/presence`: istniejący canonical origin/host + JSON guard,
strumieniowy limit body 256 bajtów, UUIDv4 i ścisły zestaw pól. HttpOnly cookie,
ważność credential, lifecycle i event membership są sprawdzane serwerowo.
Event SHARE chroni lifecycle; credential SHARE chroni revoke; niezależne advisory
locks credential → membership serializują leases bez mutexu event_sessions.
Czas/expiry są sprawdzane ponownie po oczekiwaniu. Heartbeat/disconnect
w dowolnej kolejności pozostawia zakończone połączenie; heartbeat po disconnect
dostaje 409. Obcy credential nie może zmienić ani zamknąć UUID innej osoby.

Ingress defense in depth: osobny budżet 240/min/credential, niezależny od API
piosenek i wspólnego IP/NAT. Trwały limit DB: 32 nowe UUID/min/credential,
także dla phantom disconnects; co najwyżej jeden zapis heartbeat na 5 s/UUID.
Osobna mapa ingress Presence ma limit 10000 kluczy oraz cleanup wygasłych
wpisów przy ruchu, bez background interval. Pełna mapa odrzuca nowe klucze
do czasu zwolnienia miejsca; nie rośnie przy losowych fałszywych credentials.
Ochrona rozproszona HTTP wymaga warstwy WAF jak pozostałe publiczne API;
jej konfiguracji nie zmieniano w tym zadaniu.

RLS nowej tabeli jest deny-all, uprawnienia anon/authenticated/PUBLIC odebrane.
Nie ma browser direct reads/writes. Dashboard GET `/participants` i nowy
GET `/participants/presence` wymagają istniejącej sesji i aktywnego lokalnego
membership właściwej organizacji. Viewer ma odczyt, nie mutację zarządzania.
Owner/manager/operator zachowują dotychczasowe uprawnienia. Nie ma bypassu
platform role lub client-supplied organization/role. Credentials/connection
records nie są publicznym API; brak tokenów w nowych logach/payloadach.

Kanał z 0028: dashboard:event:{eventId}:participants, prywatny, participants_changed.
Payload dokładnie eventId/type/operation/changedAt. Sygnał przy online/offline
lub skróceniu aggregate deadline przez zamknięcie karty. Heartbeat extensions
nie rozsyłają odświeżenia panelu. Wewnętrzny trigger credential invaliduje
eventy przy revoke/expiry change/delete; function ma pusty search_path i brak
EXECUTE dla klientów. Polityka kanału 0028 pozostaje RBAC z kontrolą zawieszenia.

## Offline po TTL bez beacona i UI

API zwraca serverNow i najbliższy deadline, bez listy connections. Jednorazowy
timer dashboardu pyta serwer o mały snapshot obecności. Nie oznacza sam osoby
jako offline. Gdy heartbeat przedłużył lease, odpowiedź podaje kolejny deadline;
gdy wszystkie wygasły, serwer zwraca offline i brak następnego timera.
Nie ma pollingu całej listy, historii ani kolejki. Error ma stan sprawdzania
i retry snapshotu. Starsze odpowiedzi nie nadpisują nowszego snapshotu.
Focus/foreground i subscribe/reconnect uzupełniają dane po utracie invalidacji.

Istniejący panel ma Online/Offline, licznik obecnych, stan łączenia/Reconnect
Realtime i error/unknown presence. Pozostają manual create, historia, katalog,
licznik 2/2 i RBAC. Badge ma tekst, nie sam kolor. Zachowano polski interfejs,
semantyczne etykiety i mobilny layout; bez nowego dashboardu/redesignu.

## Migracja i retencja

0029_participant_presence.sql + journal/snapshot, wygenerowane Drizzle Kit.
Nowa tabela/indeksy/FK/check/RLS i credential invalidation trigger. Bez backfillu,
zmian istniejących tabel czy danych. Drizzle schema generation po zmianach
zwróciło "No schema changes". Łańcuch do 0029 działa na realnym Postgres 17
i izolowanym Supabase 17. Runbook z preflight, verification i rollback:
`docs/migrations/0029-participant-presence.md`.

Retencja dotyczy wyłącznie efemerycznych leases: każdy nowy rekord usuwa do
1000 rekordów z expiry starszym niż 24 h, SKIP LOCKED + indeks expiry.
W nieaktywnym systemie stare rekordy czekają do kolejnego zapisu; bez nowych
zapisów tabela nie rośnie. Identity, credentials, membership i historia nie są
usuwane. Stary heartbeat po cleanup dostaje 409. Tombstone chroni również
replay connect w okresie retencji; UUID nie jest tokenem uwierzytelnienia.

## Testy i problemy rozwiązane

| Weryfikacja | Wynik |
| --- | --- |
| Review baseline participantIdentity na PG17 | PASS 3/3 |
| pnpm test | PASS: Node 372/372, Vitest 577/577 w 49 plikach |
| pnpm typecheck | PASS, po E2E cleanup, także po ostatnim wzmocnieniu testu |
| pnpm lint | PASS |
| pnpm build | PASS, Next 16.3.0/Turbopack, sekwencyjnie po typecheck/lint; bez równoległego E2E |
| git diff --check | PASS |
| pnpm test:postgres:public-event-session-identity | PASS 8/8 w 4 plikach, wyłącznie PG17 |
| pnpm test:postgres:owner-guard | PASS 23/23, domyślny harness PG17 |
| E2E grep tracks | PASS 1/1, 1,6 min: join online 2458 ms, network TTL offline 41059 ms, closed tab bez beacona 40440 ms; multi-tab, reload, reconnect |
| E2E grep manages | PASS 1/1, 26,6 s: join invalidation 1402 ms, manual participant, operator/public capacity, history, Realtime i mobile |
| E2E grep 2/2 | PASS 1/1, 24,7 s: aktualizacja limitu przez Realtime 1530 ms, HTTP/reload/operator actions |

W PG: pełna migracja 0029, 40 osób/80 równoczesnych leases, dwa heartbeat,
heartbeat/disconnect, replay, różne credentials, foreign person/event/workspace,
viewer i RLS SELECT/INSERT także po testowym nadaniu praw, revoke/expiry,
manual offline, controlled SQL expiry bez sleep, retencja, 32/min guard,
brak nowych uczestników/historii od heartbeat, kolejka z zajętym mutexem,
event close, payload privacy i wspólny limit 2/2.

Component/API: strict input, CSRF/JSON/body limit, heartbeat budget, safe errors,
unikalne tab IDs, pagehide/pageshow, sieć/online/409/403, deadline extension,
server-confirmed offline, brak list pollingu i error retry.
Końcowy focused Vitest: 28/28 w 4 plikach.
Po wzmocnieniu równoczesnego heartbeat o rzeczywisty zapis/odnowienie 40 s
ponownie uruchomiono participantIdentity: PASS 4/4 na PG17 (33,33 s) oraz
pełną sekwencję test/typecheck/lint/build. Brak skipów w końcowych wynikach.

Końcowy runtime: agent-browser 0.35.1, osobna sesja next-dev-loop-slice3,
publiczny root, snapshot i rzeczywiste React tree. Next DevTools widzi nowe
trasy Presence; get_compilation_issues zwróciło issues=[] i get_errors puste
configErrors/sessionErrors. Sesję przeglądarki zamknięto, własny next dev 3000
pozostawiono. To kontrola podstawowego runtime; dowód funkcjonalny Presence
pochodzi z izolowanego E2E z zastosowanymi migracjami, nie ze zdalnej bazy
skonfigurowanej dla domyślnego dev. Nie migrowano tego środowiska.

Ordinary failures naprawione bez skipów/osłabiania ochrony:
- Raw parametr Date w SQL cleanup wymagał jawnego ISO/timestamptz dla postgres-js.
- Negatywny test RLS obejmuje odrzucenie całej transakcji, nie tylko INSERT,
  ponieważ po błędzie transakcja jest aborted.
- Test wyścigu nie może wymagać sukcesu heartbeat po zwycięskim disconnect;
  sprawdza 409 lub sukces przed disconnect i obowiązkowo końcowy offline.
- Szerszy historyczny test 0021 uruchamiał obecny generator 6 cyfr na schemacie
  8 cyfr. Historyczne asercje zachowano, potem fixture spełnia preflight 0027,
  stosuje prawdziwą migrację i przywraca testowy lifecycle do runtime checks.
  Nie zmieniono generatora produkcyjnego ani historycznej semantyki 0022.
- Windows runner nie przekazał poprawnie wielowyrazowego grep. Użyto tracks.
- Test bez beacona wzmocniono: potwierdza trwającą lease po zamknięciu i co
  najmniej 30 s do offline; nie przechodzi przypadkiem dzięki działającemu beacon.
- Dłuższy smoke wykazał HTTP500 z wygenerowanego CSS zawierającego binarne
  znaki. Trace wskazał CSS, nie API/SQL. Dedykowane cache/trace katalogi harnessu
  były nieignorowane. Dodano .next-p3-e2e/ i .playwright-p3-e2e/ do .gitignore,
  wyłączając je ze skanowania Tailwinda; bez zmiany globals.css. Świeży smoke
  przeszedł pełny lifecycle i oba rzeczywiste okresy TTL, bez HTTP500.
- Uzupełniono typowane fixture UI/mocking server-only i typ testowego zestawu
  nagłówków; nie wyłączano TypeScript, lint ani testów.

## Ograniczenia i ryzyka

- Produkcja/version/migration state i pełna pozostała suite E2E: NOT VERIFIED.
- Brak migracji na docelowym zdalnym DEV/produkcji. Kod wymaga 0028+0029.
- Brak ręcznej akceptacji wizualnej; automatyczny smoke obejmuje mobile/desktop.
- Browser throttling może opóźnić UI w uśpionym dashboardzie; foreground odpyta
  API. Serwer nadal wygasza logicznie według TTL bez procesu sprzątającego.
- Gdy brak znanych online/deadline, utracony join broadcast zostanie naprawiony
  przez focus/reconnect. Nie dodano stałego pollingu listy jako obejścia.
- Historyczne leases w nieaktywnym systemie czekają na bounded cleanup przy
  kolejnym zapisie. Dodatkowy scheduled cleanup można rozważyć po pomiarach.
- Nie wdrożono WAF ani monitoringu produkcji. Broadcast failure wycofuje
  transakcję jak w istniejącym systemie; timeout i retry prowadzą do TTL.
- Lista uczestników nadal bez paginacji (ograniczenie Slice 2); nowa agregacja
  jest zbiorcza. Test obciążenia dotyczy 40 osób/80 connections, nie gwarancji
  pojemności produkcji przy dowolnym ruchu.
- Nie ma linking/merge, Fair Queue, YouTube, co-singers, autoapproval lub rebrandu.

## Plan Slice 4: Secure Linking & Identity Merge

1. Ponownie sprawdzić Git/diff trzech slice'ów i zastosowane migracje;
   zachować config użytkownika i brak commita, jeśli nie ma nowej autoryzacji.
2. Ustalić dowód kontroli obu stron: krótko ważny jednorazowy token zapisany
   jako hash, ograniczone próby, event/workspace scope; manual participant
   wymaga świadomego uprawnionego operatora i potwierdzenia właściwej osoby.
3. Nie wyszukiwać/łączyć po nicku/IP/UA. Zaprojektować idempotencję i replay
   guard, wymagane zgody, widoczny wynik i audyt bez surowych tokenów/PII.
4. Transaction plan: stabilna kolejność locków identities/credentials/memberships
   i odpowiednich mutexów kolejki. Jawnie rozstrzygnąć dwa membership w jednym
   evencie, nickname uniqueness i łączny limit 2/2, bez utraty requests/historii.
5. Ustalić zachowanie istniejących credentials i leases po merge. Rotacja/revoke
   oraz nowy connect muszą uniemożliwiać przejęcie cudzego aktywnego połączenia.
6. Addytywna migracja z preflight i forward-fix, testy PostgreSQL17: stale proof,
   expiry/replay/race, cross-org/event, same-name attack, capacity/history,
   credentials i Presence po merge. Browser dwa urządzenia, confirm/cancel,
   odświeżenie, reconnect, bez przejęcia lub duplikacji historii.
7. Osobny etap; bez wdrażania Fair Queue/rebrandu razem z linking.

## Narzędzia, pliki i werdykt

MCP: Next DevTools i Context7. Pozostałe: lokalny shell/pnpm, Drizzle Kit,
Docker/PostgreSQL17, izolowany Supabase CLI 2.109.1/Auth/Realtime, Playwright,
agent-browser do runtime check; oficjalny changelog Supabase pobrany HTTP.
Bez remote Supabase MCP, GitHub, Vercel, Cloudflare lub mutacji produkcji.
Izolowany runner sprząta tylko własne zasoby testowe.

Pełna lista plików Slice 3 poniżej; pozostałe brudne pliki to zachowany Slice 1/2.

- `.gitignore`
- `README.md`
- `docs/architecture/adr-import-job-execution.md`
- `docs/architecture/adr-participant-presence.md`
- `docs/features/participant-model-slice-3.md`
- `docs/features/participant-song-discovery.md`
- `docs/migrations/0029-participant-presence.md`
- `drizzle/0029_participant_presence.sql`
- `drizzle/meta/0029_snapshot.json`
- `drizzle/meta/_journal.json`
- `src/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/presence/route.ts`
- `src/app/api/s/[token]/presence/route.ts`
- `src/app/s/[token]/layout.tsx`
- `src/components/operator/event-participants-api.ts`
- `src/components/operator/event-participants-panel.tsx`
- `src/components/public/participant-presence.tsx`
- `src/db/schema.ts`
- `src/lib/participant-presence.ts`
- `src/server/operator-api/event-participants.ts`
- `src/server/session-api/presence.ts`
- `src/server/session-api/rate-limit-core.ts`
- `src/server/session-api/service.ts`
- `tests/e2e/local-supabase-fixture.ts`
- `tests/e2e/public-event-session-identity.local.spec.ts`
- `tests/e2e/run-local-supabase-smoke.ts`
- `tests/participantPresenceMigration.test.ts`
- `tests/postgres/canonicalSessionAccess.integration.test.ts`
- `tests/postgres/catalogCollections.integration.test.ts`
- `tests/postgres/guestSessionQueue.integration.test.ts`
- `tests/postgres/importJobDataFoundationContract.integration.test.ts`
- `tests/postgres/importJobWorkerFoundation.integration.test.ts`
- `tests/postgres/importWorkerRuntime.integration.test.ts`
- `tests/postgres/participantIdentity.integration.test.ts`
- `tests/postgres/participantSongDiscovery.integration.test.ts`
- `tests/postgres/platformAdminImports.integration.test.ts`
- `tests/postgres/postgresTestHarness.ts`
- `tests/postgres/publicEventSessionIdentity.integration.test.ts`
- `tests/postgres/sessionCodeSixDigits.integration.test.ts`
- `tests/postgres/songPublicId.integration.test.ts`
- `tests/postgres/songSearchAdversarial.review.test.ts`
- `tests/postgres/songSearchQuality.integration.test.ts`
- `tests/postgres/songSearchSqlApiUi.integration.test.tsx`
- `tests/vitest/event-participants-panel.component.test.tsx`
- `tests/vitest/event-participants-routes.test.ts`
- `tests/vitest/participant-presence-routes.test.ts`
- `tests/vitest/participant-presence.component.test.tsx`

**PASS dla lokalnego Slice 3.** Review gate, Presence lifecycle i security,
PostgreSQL17, wszystkie wymagane końcowe checks, trzy browser smoke oraz
regresje Slice 1/2 przeszły. Nie ma znanego blokera tego lokalnego zakresu.
Produkcja i pełna pozostała macierz E2E nadal NOT VERIFIED.

Zmiany trzech slice'ów i migracje pozostają lokalnie bez commita. Brak
push/merge/deploy, produkcyjnych migracji, zmian sekretów/env/config użytkownika
i rebrandu. Przed kolejną pracą odczytać bieżący diff, trzy handoffy oraz
runbooki 0028/0029. Następny zakres: wyłącznie Secure Linking & Identity Merge.
