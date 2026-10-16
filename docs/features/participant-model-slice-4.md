# Participant Model — Slice 4: urządzenia i scalenie uczestnictwa

Data: 2026-10-16. Repo: `C:\Projects\pozanuta-stage-1`,
`3SM-Studio/poza-nuta`. Branch: `fix/song-details-drawer-desktop-position`.
HEAD: `9d1fd059c33c28d5679d4ba40037c3897285bb9d`.

Werdykt końcowy po recovery: **PASS lokalnej bramki Slice 4** — PostgreSQL 17
33/33 i dodatkowe 30/30, Node 373/373, Vitest 585/585, browser 6/6 oraz
typecheck/lint/build/diff PASS. Procesy awarii kończą się normalnie, bez
nieobsłużonych wyjątków. Diagnoza i dowody recovery: sekcja 15.
Nie wykonano produkcyjnego uruchomienia ani migracji produkcyjnych.

## 1. Stan wejściowy i ochrona wcześniejszej pracy

Przed zmianami odczytano Git, wszystkie zmiany i pliki untracked oraz handoffy
Slice 1/2/3, runbooki 0028/0029, schemat i rzeczywiste implementacje.
Zastano niezatwierdzone poprzednie slice’y i zmianę użytkownika
`.codex/config.toml`. Baseline SHA-256 zapisano lokalnie w
`.artifacts/slice4-baseline-hashes.json`. Konfiguracja użytkownika pozostaje
bajtowo niezmieniona. Lista plików tej części poniżej nie obejmuje wszystkich
wcześniejszych zmian widocznych w `git diff`.

Końcowe porównanie baseline: 41 plików tej części, brak usuniętych plików
baseline, `.codex/config.toml` zachowany, wszystkie zmienione pliki wymienione
w handoffie.

Nie wykonano reset/clean/stash/commit/push/Git merge/deploy. Nie zmieniano
`.env`, domen, produkcji, wersji PostgreSQL, danych katalogu ani brandingu.
Nie wdrożono Slice 5/6/7, autoapproval ani nowego subsystemu Presence.

## 2. Review gate Slice 3

**PASS na wejściu**: świeże cztery integracje participantIdentity na realnym
PostgreSQL 17, 4/4, 28,56 s. Dowód:
`.artifacts/slice4-review-postgres17.log`.

Sprawdzono lifecycle/credential guardy, nonce tombstones, agregację,
minimalny prywatny broadcast, niezależne advisory locks Presence, brak
pollingu i wspólny mutex kolejki dla limitu 2/2. Nie wykryto krytycznej
regresji Slice 3. Raporty poprzednich etapów nie zastępowały tego uruchomienia.

## 3. ADR i model własności

ADR przygotowano przed implementacją:
[adr-participant-linking.md](../architecture/adr-participant-linking.md).

Pozostaje `participantIdentity → eventParticipant → songRequests`.
Credential dowodzi kontroli identity; nick, IP i user-agent tego nie dowodzą.
Nowy telefon otrzymuje niezależny credential istniejącej identity po
potwierdzeniu przez jej uwierzytelnione urządzenie.

Merge jest **event-scoped**, nie globalny. Operator wskazuje source i target
w tej samej sesji wydarzenia. Target zawsze wymaga zgody ważnego credential.
Source też wymaga zgody, chyba że cała grupa źródła nie ma żadnego credential
(również wygasłego/cofniętego) i nie ma publicznych zgłoszeń. Wtedy jest to
ręczny profil, którego przypisanie potwierdza uprawniony operator.

Operator nie może sam wydać cudzego credential ani zastąpić zgody właściciela.
Osoba trzecia nie może odczytać ani potwierdzić nieswojej propozycji.
Propozycje trwają 5 min; zmiana nicku, wcześniejsze scalenie lub wygaśnięcie
zgody blokują finalizację. Bez automatycznych propozycji po podobieństwie nicków.

## 4. Token jednorazowy

1. Zaufane urządzenie wydaje losowe zaproszenie 256 bitów, TTL 3 min.
2. Drugie urządzenie wpisuje je w formularzu POST. Token nie trafia do URL,
   QR URL, referrera, analytics, broadcastów ani przeglądarkowego storage.
3. Serwer wiąże zaproszenie z losowym HttpOnly challenge cookie. Przechowuje
   tylko hashe invitation/challenge/kodu potwierdzenia, z domain separation.
4. Drugi telefon pokazuje sześciocyfrowy kod. Pierwszy musi go wpisać
   i jawnie zatwierdzić. Samo przechwycenie invitation nie daje dostępu.
5. Dopiero finish atomowo wydaje osobny credential i zapisuje jego hash.
   Trwały credential trafia wyłącznie do HttpOnly cookie.

Row lock serializuje prepare/approve/finish. Inny odbiorca nie przejmie już
przypisanego zaproszenia. Próby błędnego approval są commitowane, maks. 5.
TTL sprawdza zegar DB po czekaniu na blokady. Cofnięty/wygasły issuer nie
wyda nowego credential.

Ten sam odbiorca może przez 10 min od zużycia powtórzyć finish i odzyskać
**ten sam** credential, bez kolejnego insertu. Credential jest odtwarzany
z losowego challenge i identyfikatora invitation z osobną domeną SHA-256.
Challenge cookie pozostaje krótko również po sukcesie, aby zerwanie body
po odebraniu headers/cookie nie uniemożliwiło retry. Obcy challenge jest
odrzucany. To receipt, nie ponowne wykorzystanie tokenu przez nowe urządzenie.

Cookie credential: HttpOnly, SameSite=Lax, Path=/, 180 dni, Secure w produkcji.
Challenge: HttpOnly, SameSite=Strict, Path=/api/s, TTL zaproszenia + 10 min,
Secure w produkcji. Nie nadpisuje się ważnej innej identity na urządzeniu.
Stan w UI odświeża się jawnie, bez interval pollingu.

## 5. Scalenie, historia i credentials

Source membership pozostaje rekordem z `merged_into_id` i `merged_at`.
Target zachowuje wybrany nick i membership. Starsze aliasy źródła są
spłaszczane do jednego hopu. Guard SQL zabrania self/cross-event/cycle/chain
i cichego przywrócenia aliasu. Nick źródła pozostaje zarezerwowany przez
dotychczasowy unique index. Nie ma hard-delete identity lub historii.

Scalenie zmienia tylko `song_requests.event_participant_id`, bez zmiany ID,
public ID, dat, statusu, pozycji, wersji, wykonującego operatora i historycznego
nicku snapshot. Wszystkie urządzenia obu grup rozwiązują w tym wydarzeniu
canonical target. Każde zgłoszenie liczone jest raz; completed/now zachowują
semantykę wcześniejszych slice’ów. Nie zmieniano algorytmu Fair Queue.

Globalne identities i powiązania credentials pozostają bez zmian. Te same
credentials w innych wydarzeniach/organizacjach nadal rozwiązują oryginalne
membership. Linking rozpoczęty credential źródła po merge nadal wydaje
credential **oryginalnej identity źródła**. Alias z jednego wydarzenia nie
pozwala przejąć globalnej identity targetu lub jego innych wydarzeń.

Audyt ma wpisy propozycji, zgód/odmów, anulowania, finalizacji, przeniesienia
każdego request ID i przekierowania wcześniejszych aliasów. Finalizacja
zapisuje operatora; zgody mają actorKind=system i initiator=participant,
z technicznym credential ID. Bez tokenów i wielkich tablic JSON.

## 6. Limit 2/2 i konflikty

Finalizacja liczy łącznie pending/approved/now obu profili pod istniejącym
mutexem kolejki. Więcej niż dwa blokuje merge. Aktywny duplikat tego samego
song ID też blokuje merge. Limit ma pierwszeństwo, jeśli oba konflikty
występują naraz. UI pokazuje zgłoszenia i konflikt.

Operator rozwiązuje konflikt istniejącymi autoryzowanymi akcjami kolejki
i odświeża propozycję. Serwer ponownie sprawdza wszystkie warunki.
Brak automatycznego odrzucania, usuwania piosenek i wyjątków od limitu.
Create/restore/approve i merge korzystają ze wspólnego mutexu. Retry
zakończonego merge nie powiela historii ani audit finalizacji.

## 7. Presence i blokady

Zachowano heartbeat 15 s, TTL 40 s, osobne connectionId, tombstones,
retencję oraz brak queue mutex w heartbeat.

Finalizacja: lifecycle event SHARE → session queue mutex → identity rows
NO KEY UPDATE w kolejności ID → wszystkie credentials UPDATE w kolejności ID
→ memberships UPDATE w kolejności ID → proposal UPDATE. Nowe issuance
trzyma identity SHARE przed credential SHARE. Zapobiega to pojawieniu się
niezablokowanego nowego credential podczas merge.

Presence blokuje credential SHARE, a następnie świeżo rozwiązuje canonical
membership; nie korzysta ze snapshotu membership sprzed czekania na merge.
Scalenie przenosi te same connection rows do targetu bez zmiany ich TTL/ID.
Stary heartbeat i późny disconnect nadal dotyczą właściwego urządzenia.
Agregacja weryfikuje oryginalne credential membership przez event alias.
Minimalny prywatny Realtime unieważnia listę/queue; business data idą przez API.

## 8. Migracja i bezpieczeństwo

`0030_participant_linking.sql`, journal i snapshot. Runbook:
[0030-participant-linking.md](../migrations/0030-participant-linking.md).

Dwie nowe tabele: `participant_device_links`, `participant_merge_proposals`.
Dwa nullable pola membership, indeksy, FK/CHECK i wewnętrzne scope triggers.
Brak backfillu: istniejące membership są canonical. Nazwy nowych FK mieszczą
się w limicie PG. Drizzle generate po implementacji nie znajduje driftu.

RLS enabled, brak browser policies, REVOKE ALL dla PUBLIC/anon/authenticated.
Prywatne trigger functions bez EXECUTE dla tych ról i z pustym search_path.
DB i APIs odrzucają cross-event/workspace; viewer nie może proponować ani
finalizować merge. Serwer bierze auth user ze zweryfikowanej sesji operatora.

Mutation: wymagane JSON, poprawny Origin, ścisłe klucze i maks. 1024 B
odczytywanych strumieniowo. UI nie dostarcza roli, ownera ani consent credential.
Cache-Control=no-store; linking dodatkowo Referrer-Policy=no-referrer.
Źródłowy token widoczny tylko po wydaniu, znika z pamięci UI po zamknięciu.

Rate limiting: osobny budżet 60/min/IP i credential, bounded in-memory map
(10 tys. kluczy, cleanup), oraz atomowe DB 5 invitations/min/**identity**,
5 błędnych approval/invitation i 5 proposals/min/operator/event. Zmiana
urządzenia tej samej identity nie omija DB quota. In-memory limit nie jest
globalną gwarancją między instancjami; nie deklarowano konfiguracji WAF.

## 9. Weryfikacja pierwotna (przed recovery)

| Zakres | Wynik i dowód lokalny |
| --- | --- |
| Review wejściowy PG17 | 4/4 PASS, slice4-review-postgres17.log |
| pnpm test | Node 373/373, Vitest 585/585 PASS, slice4-full-test-final-gate.log |
| TypeScript | PASS, slice4-typecheck-final-gate.log |
| ESLint | PASS, slice4-lint-final-gate.log |
| Production build | PASS, slice4-build-final-gate.log |
| git diff --check | PASS po normalizacji końców linii plików tej części |
| PostgreSQL 17, pełna sesyjna integracja | **FAIL bramki**: 11/11 assertions PASS, ale 1 unhandled exception, slice4-postgres-final-gate.log |
| PG17 db-contention | 4/4 PASS, slice4-db-contention.log |
| PG17 owner guard | 23/23 PASS, slice4-owner-guard.log |
| Nowy browser smoke | 1/1 PASS, slice4-browser-linking-list-diagnostic.log |
| Regresje browser | 5/5 PASS, slice4-browser-regressions.log |
| Drizzle schema drift | No schema changes, slice4-schema-final-gate.log |

Wszystkie ścieżki `.log` w tabeli są pod ignorowanym `.artifacts/`.
Tylko PostgreSQL 17: test containers postgres:17-alpine, lokalny Supabase
sprawdził server_version_num=170006. Nie uruchamiano PG15/16.

Końcowy pełny PG run: 52,90 s, wszystkie cztery pliki i 11 przypadków
ukończone, ale exit code 1 wskutek wyjątku drivera. Nie przedstawia się tego
uruchomienia jako PASS. Wcześniejszy pełny run bez twardego zerwania miał
11/11 PASS (45,76 s); nie zastępuje to brakującego dowodu odporności transportu.

Nowe realne testy obejmują: dwa prepare tego samego invitation, retry finish
bez drugiego credential, expiry po lock wait, błędny kod/approval quota,
obcy credential/challenge, issuer proof, shared identity quota, RLS odmowy,
manual claim i dwie zgody, idempotent merge, zachowanie pełnego JSON request
poza membership FK, alias flattening, cross-event/workspace/viewer, Presence,
linking z aliasu bez eskalacji globalnej, prywatny minimalny broadcast/audit.

Wyścigi PG: merge/create, merge/start, merge/rename, merge/heartbeat,
dwa różne merge, dwukrotna finalizacja, anulowanie zapytania w środku
reparenting i wymuszone zamknięcie backend connection. Kolejka i ruch
memberships używają rzeczywistych transakcji i sprawdzonych lock waitów.

Browser: realny Supabase Auth, cztery browser contexts i osobne HttpOnly
cookies. Jedna identity, dwa credentials, ten sam limit 2/2, wspólne Presence,
reload na 390 px bez overflow. Test faktycznie zrywa odpowiedź HTTP po commit
finish i ponawia flow, potwierdzając dokładnie dwa credentials. Potem manual
claim z historią, cancel przed finalizacją, dwie zgody istniejących profili,
blokada limitu, rozwiązanie przez zwykłe wykonanie utworu i końcowy merge.
Zachowane cztery zgłoszenia i trzy online connections po końcowym merge.

Regresje browser: public/dashboard Realtime, Presence reconnect/reload i
offline po 40 s bez beacona, Participant Management/operator request,
wspólny limit 2/2 oraz discovery→request. Presence TTL zmierzono 40046 ms
i 40385 ms, join online 909 ms, management invalidation 273 ms,
capacity invalidation 365 ms. To pomiary lokalne, nie SLA produkcyjne.

## 10. Pierwotne niepowodzenia i ograniczenia (przed recovery)

Nie ukryto wcześniejszych błędów: stare fixtures bez 0030 wymagały addytywnego
rozszerzenia; typecheck wychwycił niepoprawne typy statusu i testowego role
matcher; statyczny test source musiał uwzględnić nowy canonical resolver.
Pierwsze browser smoke ujawniły zamykanie dwóch modalów oraz przedwczesny
komunikat sukcesu przed refetch. Zastąpiono zagnieżdżenie jednym dostępnym
oknem z krokiem alertdialog i poprawiono busy/close; test regresji czeka
na ukończenie odświeżania przed sukcesem. Kolejny pełny smoke przeszedł.

Diff check wykrył CRLF po zapisie skryptem Windows. Znormalizowano wyłącznie
pliki modyfikowane w tej części; nie zmieniano ustawień Git. Lint rozpoczęty
podczas tworzenia alternatywnego katalogu Next przerwano i uruchomiono
sekwencyjnie po cleanup browser suite. Wynik końcowy PASS.

Test 2/2 miał niedeterministyczny fixture: po wyścigu restore/create wybrany
utwór mógł już być aktywnym duplikatem, więc poprawnie dostawał duplicate
zamiast limit. Dedykowany nowy utwór izoluje test limitu; zabezpieczeń nie
osłabiono i nie zmieniono pierwszeństwa biznesowej walidacji.

**Twarde zerwanie DB:** wcześniejszy test pg_terminate_backend wycofał dane
i umożliwił retry, ale Vitest wykrył nieobsłużony `TypeError: Cannot read
properties of null (reading 'write')` w `postgres@3.4.9/src/connection.js`,
`nextWrite`. Nie zignorowano błędu globalnym handlerem, broad catch ani
ustawieniem Vitest. Test hard disconnect pozostał w końcowej integracji.
Samo pg_cancel_backend i utrata odpowiedzi HTTP przechodzą. Runtime drivera
podczas faktycznego zerwania transportu wymaga osobnej diagnozy; nie zmieniano
wspólnego poola ani zależności, żeby ukryć wynik. Do tego czasu PARTIAL.

Nie wykonywano produkcyjnych migracji, produkcyjnego smoke ani konfiguracji
WAF. Nie uruchamiano pełnego zestawu importów, guest-session i db-timeout
integration; ich runtime nie jest rozszerzany przez ten slice. Fixtures
korzystające z bieżącego participant service dostały wymagane nullable pola
przez 0030 bez zmieniania historycznych migracji.

## 11. Ryzyka i forward-fix

- Transport DB: pierwotny blocker zamknięty w recovery (sekcja 15).
  Wersjonowany patch sterownika wymaga utrzymania do sprawdzonego release upstream.
- Aplikacja wymaga 0030 przed uruchomieniem. Po pierwszym merge rollback kodu
  bez aliasów jest niebezpieczny; potrzebny forward-fix zgodny z aliasami.
- Nie ma automatycznego undo merge. Błędne przypisanie wymaga osobno
  autoryzowanej analizy audit i nowych zgłoszeń, bez zgadywania własności.
- Utrata wszystkich credentials nie ma tu procesu recovery. Cofnięty lub
  historycznie credentialed profil nie jest traktowany jako ręczny.
- Zakończone invitations/proposals nie są automatycznie usuwane. Retencja
  wymaga oddzielnej polityki; nie wykonywano usuwania danych biznesowych.
- Nie ma globalnego merge identity ani współdzielenia cudzej globalnej
  identity przez alias. Stare nicki membership pozostają zarezerwowane.

## 12. Narzędzia i działania zewnętrzne

Odczytano personal codex-prompt-strategist i cztery referencje oraz projektowe
skille architecture/backend/security/Auth-RBAC/migration/Realtime/frontend/
UI/testing, Supabase/Postgres i next-dev-loop. Nie delegowano pracy agentom.

Użyto lokalnych: PowerShell, Python, pnpm/Node/TypeScript/Vitest/ESLint,
Drizzle Kit, Docker PostgreSQL17, tymczasowy Supabase CLI, Playwright,
agent-browser. MCP: Next DevTools (kompilacja/routes/errors/runtime metadata)
i Context7 (Drizzle self-reference/alias). Next get_compilation_issues zwrócił
issues=[], a get_errors lokalnego browser runtime configErrors/sessionErrors=[].

Brak Supabase remote MCP, GitHub API, Vercel/Cloudflare ani zmiany usług
zdalnych. Testowe Auth konta i migracje dotyczyły wyłącznie izolowanej,
usuwanej po smoke instancji lokalnej. Usuwano tylko disposable fixtures.

## 13. Pliki zmienione w Slice 4

Lista jest względem baseline tej części, a nie HEAD z wcześniejszymi slice’ami:

- docs/architecture/adr-participant-linking.md
- docs/features/participant-model-slice-4.md
- docs/migrations/0030-participant-linking.md
- drizzle/0030_participant_linking.sql
- drizzle/meta/0030_snapshot.json
- drizzle/meta/_journal.json
- src/db/schema.ts
- src/lib/participant-linking.ts
- src/server/session-api/participant-membership.ts
- src/server/session-api/linking.ts
- src/server/session-api/identity-http.ts
- src/server/session-api/service.ts
- src/server/session-api/presence.ts
- src/server/session-api/rate-limit-core.ts
- src/server/operator-api/participant-merge.ts
- src/server/operator-api/event-participants.ts
- src/app/api/s/[token]/identity/linking/route.ts
- src/app/api/s/[token]/identity/merges/route.ts
- src/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/merges/route.ts
- src/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/merges/[proposalId]/route.ts
- src/components/participant-merge-preview.tsx
- src/components/public/participant-identity-dialog.tsx
- src/components/public/participant-join-gate.tsx
- src/components/public/participant-profile-drawer.tsx
- src/components/public/session-api.ts
- src/components/public/session-request-page.tsx
- src/components/operator/participant-merge-panel.tsx
- src/components/operator/event-participants-panel.tsx
- tests/participantLinkingMigration.test.ts
- tests/sessionEventAccess.test.ts
- tests/vitest/participant-linking-routes.test.ts
- tests/vitest/participant-linking.component.test.tsx
- tests/postgres/participantIdentity.integration.test.ts
- tests/postgres/participantSongDiscovery.integration.test.ts
- tests/postgres/catalogCollections.integration.test.ts
- tests/postgres/publicEventSessionIdentity.integration.test.ts
- tests/postgres/dbContention.integration.test.ts
- tests/postgres/dbTimeoutHierarchy.integration.test.ts
- tests/postgres/guestSessionQueue.integration.test.ts
- tests/e2e/local-supabase-fixture.ts
- tests/e2e/public-event-session-identity.local.spec.ts

## 14. Następny Slice 5 — plan, bez implementacji

Transport DB verification gate zamknięto w recovery; środowisko/migracje
wymagają osobnej autoryzacji. Następny etap to ADR Fair Queue: źródło historii występów,
semantyka cofania statusów, canonical event participant i aliasy, stabilne
tie-breakers oraz operator override. Nie opierać fairness na credential,
connectionId, aktualnym nicku ani ponownym dołączeniu.

Projektować deterministyczny engine nad zachowanymi request IDs/datami,
testować combined history po merge i równoczesne start/restore/create.
Limit 2/2, lifecycle, RBAC i minimalny Realtime pozostają obowiązujące.
Nie łączyć tego etapu z external songs, co-singers ani autoapproval.

## 15. Recovery: fault tolerance Postgres.js (2026-10-16)

Ta sekcja uzupełnia historyczne wyniki powyżej. Pierwotny FAIL pozostaje
zapisany jako dowód; nie był uznany za PASS na podstawie samych assertions.
Recovery nie implementuje Slice 5 ani zmian UX, schematu lub konfiguracji DB.

### Diagnoza i źródła

Npm `latest` i oficjalny [release](https://github.com/porsager/postgres/releases/tag/v3.4.9)
nadal wskazują 3.4.9. Odczytane
[1208](https://github.com/porsager/postgres/issues/1208) oraz
[1248](https://github.com/porsager/postgres/issues/1248) opisują zarówno
null-socket `nextWrite`, jak i kontynuowanie callbacku po odrzuceniu `begin`.
[PR 1209](https://github.com/porsager/postgres/pull/1209) i
[PR 1215](https://github.com/porsager/postgres/pull/1215) są open/unmerged.
Dokładne przejrzane SHAs, zakres i warunki usunięcia patcha:
[patches/README.md](../../patches/README.md).

Pristine 3.4.9, Node 24.19.0, PostgreSQL 17, child OS process:

1. BEGIN, zapis markera, pobranie backend PID, rzeczywiste `pg_sleep`.
2. Admin wykonuje `pg_terminate_backend` dopiero po potwierdzeniu PgSleep.
3. `begin` odrzuca obietnicę; callback próbuje dokończyć obsługę błędu.
4. Opóźniony `Immediate.nextWrite` wywołuje `socket.write` przy `socket=null`.
5. Rzeczywisty proces kończy się kodem 1, poza promise error handling:

```text
TypeError: Cannot read properties of null (reading 'write')
    at Immediate.nextWrite (.../postgres/src/connection.js:255:22)
    at process.processImmediate (node:internal/timers:534:21)
```

Dowody lokalne: `.artifacts/slice4-recovery-unpatched-crash.log` i
`slice4-recovery-baseline-repro.log`. Osobny A/B z zachowaną pristine kopią
pakietu, bez podmieniania node_modules podczas testu: 18 FAIL, 2 PASS
(kontrola jawnego client-end) w 20 przypadkach. Log
`slice4-recovery-pristine-driver.log` i osobne `pristine-{esm,cjs}-*.log`
rozróżniają uncaught TypeError/exit 1, poprawnie odrzuconą obietnicę oraz
timeout. Idle callback potrafił wykonać INSERT na replacement connection;
late COMMIT/ROLLBACK zmieniał txid nowej transakcji. To defekt sterownika,
nie dowód nieprawidłowego użycia transakcji Drizzle przez aplikację.

Pierwsza wersja patcha ujawniła dodatkowy przypadek TCP: `error` odrzuca
zapytanie, callback kolejkuje ROLLBACK, dopiero potem następuje `close`.
Warunek `!hadError` pomijał opróżnienie `sent`. Po reconnect pierwszy SELECT
przechodził, ale BEGIN wisiał przy bezczynnym backendzie. Diagnostyka
lokalna: `slice4-recovery-debug-esm-tcp.log` (stare `sent.length=1`).
Wyniki przejściowe FAIL/timeout nie zastępują końcowej weryfikacji.

### Naprawa i testy

Minimalny wersjonowany `patches/postgres@3.4.9.patch`, zarejestrowany przez
pnpm w workspace i lockfile; wersja aplikacji przypięta do dokładnie 3.4.9.
Nie zaktualizowano innych pakietów. Patch obejmuje ESM, CJS oraz identyczne
zmiany workerd; runtime workerd nie jest weryfikowany w tym projekcie.

- Null socket odrzuca pending queries, czyści deferred write i zwraca false.
- Close czyści protocol/error/result state i odrzuca pozostałe `sent`, także
  po wcześniejszym `error`; stary ROLLBACK nie trafia na nową sesję.
- Disconnected transaction odrzuca prywatną kolejkę oraz każde późniejsze
  SQL/savepoint/COMMIT/ROLLBACK bez wykonania na replacement connection.
- Disconnected reservation odrzuca kolejkę i stale queries. Idempotentny,
  spóźniony release nie otwiera martwego połączenia ani nie zwalnia nowego
  właściciela tego samego obiektu Connection.

Nie ma globalnych uncaughtException/unhandledRejection hooks, ignorowania
błędów, wyłączenia testów ani automatycznych retry transakcji biznesowych.
Stałe poola i timeouty aplikacji pozostają niezmienione. Surowe workers
wyłączają type discovery wyłącznie dla izolacji transportu; application
integration i browser smoke używają zwykłej konfiguracji. Rezerwacje pobierane
są z wcześniej zestawionego poola, również po normalnym reconnect SELECT.

Nowe raw Node children: 11 scenariuszy × ESM/CJS = 22. Rodzic obserwuje
rzeczywiste close, exit code, signal i 15 s timeout z zatrzymaniem drzewa
procesów. PASS wymaga normalnego wyjścia 0 po cleanup, nie samego markera.
Scenariusze: aktywna transakcja + terminate, TCP reset, queued TCP reset,
queued terminate, client-end, idle late query/commit/rollback/savepoint,
stale reserved i reserved queued. Sprawdzane są kody odrzuceń, zakończenie
starego backendu, brak częściowego zapisu i retry przez zdrowy pool.

Oryginalny test merge races/conflict policy ma wszystkie dotychczasowe
assertions, a teraz działa w osobnym Vitest OS child. Nie ma późnego błędu
ukrytego przez runner rodzica. Przerwanie w czasie reparentingu Presence
przez cancel i terminate sprawdza pełny snapshot historii/requestów,
credentials, global identities, memberships/aliasów, Presence i proposal.
Retry przenosi własność i Presence, zachowuje historyczny JSON oraz
credentials i daje dokładnie jeden audit finalizacji mimo powtórzenia.
Zachowano merge/create limit 2/2 i jednokrotność invitation/credential issuance.

### Końcowa weryfikacja recovery

Wszystkie logi poniżej znajdują się w ignorowanym `.artifacts/`.

| Polecenie / zakres | Wynik | Dowód |
| --- | --- | --- |
| pnpm install --frozen-lockfile | PASS | slice4-recovery-install.log |
| pnpm test | 373 Node + 585 Vitest PASS | slice4-recovery-test-final.log |
| Pełna PG17 sesyjna bramka | 33/33, 5 plików, PASS | slice4-recovery-postgres-final.log |
| W tym raw fault workers | 22/22 PASS | slice4-recovery-{esm,cjs}-*.log |
| Merge races/fault child | exit 0, PASS | slice4-recovery-business-merge-child.log |
| PG17 db-contention | 4/4 PASS | slice4-recovery-contention.log |
| PG17 db-timeouts | 3/3 PASS | slice4-recovery-timeouts.log |
| PG17 owner guard | 23/23 PASS | slice4-recovery-owner-guard.log |
| Next runtime MCP | issues=[], configErrors=[], sessionErrors=[] | aktywny runtime smoke na porcie 3105 |
| Browser regresje Slice 1–3 | 5/5 PASS | slice4-recovery-browser-regression.log |
| Browser linking/manual claim/merge/lost response | 1/1 PASS | slice4-recovery-browser-linking.log |
| pnpm typecheck | PASS | slice4-recovery-typecheck-final.log |
| pnpm lint | PASS | slice4-recovery-lint-final.log |
| pnpm build | PASS | slice4-recovery-build-final.log |
| git diff --check | PASS | slice4-recovery-diff-final.log |
| Zachowanie zastanych plików | 106 istnieje; zmienione tylko test i handoff | slice4-recovery-preservation.json |

**PASS lokalnej bramki Slice 4**: pełny PG17 run trwał 45,33 s, exit 0,
33/33, brak unhandled errors. Dodatkowe bramki PG17 dały 30/30. Wszystkie
22 raw workers oraz merge fault child zakończyły się normalnym exit 0,
bez signal i bez timeout. Brak wymaganej, pominiętej weryfikacji recovery.
Browser korzystał wyłącznie z izolowanego Supabase/PostgreSQL 17.6.

Wczesny typecheck wykrył wymagane NODE_ENV w pełnym ProcessEnv. Parametr
helpera oznacza teraz precyzyjnie `Partial<ProcessEnv>` (nadpisania scalane
z istniejącym środowiskiem), bez castów lub osłabiania typów aplikacji.
Pierwszy pełny A/B uruchomiono równolegle z instalacją patcha: część children
trafiła na chwilowy brak pakietu. Tego runu nie użyto jako dowodu; właściwy
pristine run importował niezmienną osobną kopię opublikowanego pakietu.
Pierwszy lint objął robocze kopie upstream pod `.artifacts/` (261 errors,
882 warnings). Zachowano je poza repo w katalogu tymczasowym; ponowny pełny
`pnpm lint` przeszedł bez zmiany reguł lub wykluczania kodu projektu.

### Zakres plików i działania zewnętrzne recovery

Zmiany tej części: package.json, pnpm-lock.yaml, pnpm-workspace.yaml,
patches/postgres@3.4.9.patch, patches/README.md,
vitest.public-session-postgres.config.ts,
tests/postgres/faultProcessHarness.ts,
tests/postgres/postgresDriverFault.worker.mjs,
tests/postgres/postgresDriverFault.integration.test.ts,
tests/postgres/participantIdentity.integration.test.ts oraz ten handoff.

Baseline recovery obejmuje 106 zastanych plików. Brak usunięć. Z wcześniejszej
pracy rozszerzono tylko istniejący test participantIdentity oraz ten raport;
kod biznesowy/UI, migracje 0028–0030 i `.codex/config.toml` zachowane bajtowo.
Nie zmieniono env. Migracje zastosowano wyłącznie do disposable lokalnych
fixtures PostgreSQL 17/Supabase Auth, bez działań produkcyjnych i zdalnych
mutacji. Nie wykonano commit/push/deploy ani migracji nowych lub zdalnych.

Użyto PowerShell, Python, pnpm/Node, Vitest, TypeScript, ESLint, Next build,
Docker PG17, istniejącego runnera Supabase CLI/Playwright. MCP: Context7
(kontrakt transakcji Postgres.js), Next DevTools (runtime errors/compilation).
Web/npm/GitHub API: wyłącznie odczyt wskazanych upstream issues, PR diffs,
release/dist-tags. Odczyt changelogu Supabase, bez zmian usług/config.
Nie użyto zdalnego Supabase MCP, nie delegowano pracy agentom.

Patch jest lokalną odpowiedzialnością utrzymaniową do czasu przetestowanej
oficjalnej stabilnej wersji. Nie deklaruje odporności na każdy błąd Postgres.js
ani testów PgBouncer/type-discovery z późniejszego komentarza 1248. Zwykłe
application integrations weryfikują normalny type discovery. Ryzyka produktu
z sekcji 11 poza zamkniętym blockerem transportu pozostają aktualne.
