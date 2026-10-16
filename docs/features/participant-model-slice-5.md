# Participant Model, Slice 5: Fair Queue

Data: 2026-10-16. Werdykt: **PASS — Slice 5 Recovery zamknięte**.
Konflikt 0027 naprawiono w przygotowaniu izolowanych testów, zachowując guard,
dane i wszystkie asercje. Świeże bramki: PG17 47/47, migracja 0027 9/9,
guest 2/2, contention 4/4, timeouts 3/3, browser 10/10 w jednym runie,
Node 391/391 i Vitest 597/597. Sekwencyjne test → typecheck → lint → build →
diff-check zakończyły się exit 0. Brak niewykonanej wymaganej weryfikacji.
Nie wykonano commita, pusha, wdrożenia ani migracji produkcyjnej. Slice 6
pozostaje wyłącznie planem.

## Repozytorium i ochrona wcześniejszej pracy

`C:/Projects/pozanuta-stage-1`, origin
`https://github.com/3SM-Studio/poza-nuta.git`, branch
`fix/song-details-drawer-desktop-position`, HEAD
`9d1fd059c33c28d5679d4ba40037c3897285bb9d`. Istniejący worktree, bez
reset/clean/stash, zmiany historii, commita/pusha/merge/deploy.

Na wejściu zinwentaryzowano 115 zmienionych/untracked plików. Zweryfikowana
lokalna kopia 114 plików znajduje się w
`C:/Users/michas/AppData/Local/Temp/pozanuta-slice5-baseline-jsffgk85/worktree.zip`.
Nie usunięto jej; po wznowieniu ponownie sprawdzono SHA-256 każdego wpisu.
`.codex/config.toml` celowo nie kopiowano do archiwum: zachowany hash zgodny
z baseline. Inwentarze: `.artifacts/slice5-baseline-hashes.json` i
`slice5-backup-inventory.json`. Żaden zastany plik nie zniknął.

Zachowane migracje 0028–0030, schemat, journal, patch Postgres.js, lockfile,
konfiguracja użytkownika i kod uczestnictwa/Presence/linkingu. Brak edycji env,
brandingu, danych katalogu, konfiguracji usług i produkcji. Część plików
zmodyfikowanych przez Slice 5 zawiera także wcześniejszą niezatwierdzoną pracę;
diff względem HEAD nie jest wyłącznie diffem tego slice'a.

Odczytano personal codex-prompt-strategist i cztery referencje, AGENTS.md,
handoffy Slice 1–4, ADR linking/Presence, projektowe skille architektury,
backendu, security, Auth/RBAC, Realtime, frontendu, UI, testów, migracji oraz
Supabase/Postgres; lokalne docs Next Route Handlers i zasady komponowania UI.
Nie delegowano pracy agentom. Pierwszy świeży review Slice 4 Recovery:
**33/33 PG17 PASS** (`slice5-review-slice4-postgres17.log`, 46,50 s).

## Architektura i matematyka

ADR zapisano przed implementacją:
[adr-fair-queue.md](../architecture/adr-fair-queue.md).
Jedna czysta funkcja w `src/server/fair-queue.ts`, jeden adapter Drizzle
`operator-api/fair-queue-store.ts`. API i React nie liczą własnej fairness.

`round = max(0, completed + allocatedNow - waitCredit) + ordinal`.
Completed to obecne done; now rezerwuje przydział, ale nie jest ukończeniem.
Ordinal jest od zera, wyłącznie wśród approved danego canonical membership.
Pending nie zajmuje rundy ani zatwierdzonego miejsca. Skipped/rejected nie
liczą się jako występ. Restore usuwa done z bieżącej historii i wraca do
pending, zgodnie z wcześniejszym modelem. Istniejąca akcja approved→done oraz
automatyczne domknięcie now przy kolejnym start pozostają bez zmian.

Tie-breakery: runda, ordinal, ostatnia akceptacja, request ID. Pełny sort
zachowuje kolejność utworów jednej osoby według akceptacji. Stabilność nie
zależy od kolejności SQL, pozycji po ręcznym ruchu ani zegara przeglądarki.
Soft adjacency wybiera inną osobę, jeśli istnieje; punktem początkowym jest
now, a przy jego braku ostatnie done. Może przekroczyć granicę rundy, ale nie
blokuje jedynego wykonawcy. Wpływ now jest uwzględniony zarówno w rundzie, jak
i adjacency. Exact fixtures obejmują też ponowne sortowanie i odwrócone wejście.

WaitCredit to liczba zakończeń innych osób po potwierdzonym waitingSince.
Każde takie zakończenie odejmuje historyczną rundę do minimum zera. Starszy
utwór po osiągnięciu zera wyprzedza świeże pierwsze piosenki; test wielorundowy
sprawdza dokładną kolejność przy ciągłym napływie nowych osób. Nie jest to
gwarancja czasu przy ręcznych interwencjach, pauzie lub zmianach historii.

### Audyt akceptacji i dane istniejące

Nie zakłada się kompletnego audytu starszych danych. Normalna akceptacja ma
event_queue_approve, request ID i serwerowy timestamp. Reapprove bierze nowy
timestamp, więc oczekiwanie pending nie daje dodatkowego kredytu.

Przy braku audytu creation time jest wyłącznie deterministycznym tie-breakerem,
nie dowodem akceptacji. waitingSince=null daje zero waitCredit. Następny udany
Fair Insert lub Fair Sort zapisuje event_queue_fair_anchor jako obserwację
serwera w tej samej transakcji. Nie antydatuje akceptacji, nie zmienia requestu
ani historii. Od tej chwili legacy approved może zbierać waitCredit. Preview
niczego nie backfilluje. Ponowne sortowanie nie tworzy drugiej kotwicy.
Korekta ta powstała podczas wznowionego audytu; pierwotne użycie creation time
do kredytu było zbyt optymistyczne wobec braków audytu.

Canonical eventParticipant ID uwzględnia event-scoped alias Slice 4. Merge
przenosi istniejące request IDs, nie kopiuje historii, więc każdy done liczy
się raz. Nie używa się credential, urządzenia, Presence ani nicku jako klucza.
Manual membership działa jak public membership. Null participant FK dostaje
osobny klucz requestu i zero przypisywalnej historii. Zgodność nicków nigdy
nie łączy legacy rekordów. Inne wydarzenia nie wchodzą do snapshotu.

## Fair Insert, ręczne sortowanie i pełny sort

Akceptacja pending/rejected→approved wylicza miejsce tylko dla nowego utworu.
Zachowuje wzajemną kolejność wszystkich istniejących approved, także ręcznych.
Nie wyprzedza istniejących piosenek tej samej osoby. Wśród dozwolonych miejsc
minimalizuje dodatkowe sąsiedztwa tej samej osoby, potem inwersje fair-key
dotyczące nowego utworu, potem wybiera pierwsze miejsce. Nie przebudowuje
całej kolejki. W istniejącym serwisie pozostają guardy limitu 2/2 i duplikatów.
Renumeracja daje 1..N; wersje rosną tylko zmienionym rekordom. Akceptacja
zwraca pełne kanoniczne items, bo przesuwa też sąsiadów.

`POST /api/dashboard/organizations/[organizationId]/events/[eventId]/queue/fair`
przyjmuje `{action:"preview"}` lub `{action:"apply",revision}`. Podgląd pokazuje
przed/po, tytuł i nazwę wykonawcy. SHA-256 revision obejmuje event, requesty,
statusy, wersje, pozycje, canonical IDs, daty i kotwice oraz ostatni sort audit.
Apply ponownie ładuje snapshot pod mutexem, sprawdza revision i przelicza wynik.
Nie przyjmuje kolejności od klienta. Stary podgląd daje 409
FAIR_QUEUE_PREVIEW_STALE bez częściowego zapisu. Udany no-op też audytuje
finalizację, więc ten sam podgląd nie przechodzi dwukrotnie.

Zachowano istniejący DnD, przyciski ruchu i publiczny odczyt pozycji. Nowa
akcja operatora ma dostępny klawiaturą dialog z anulowaniem, loading, empty,
no-change, network error, odmową RBAC, komunikatem starego podglądu i sukcesem.
Stary podgląd wymaga nowego potwierdzenia, nie autoapply innego układu.
Podczas requestu fair lokalne mutacje są blokowane, a generacja refreshu
unieważniana. Kanoniczna odpowiedź zastępuje bazę; nadal oczekujące operacje
lokalne są odtwarzane przez istniejący mechanizm optimistic UI.

## Bezpieczeństwo, mutex i Realtime

Ten sam lifecycle guard i event_sessions FOR NO KEY UPDATE, z istniejącym
event-row fallback. Brak nowej kolejności identity/credential locks, brak
zewnętrznych wywołań pod lockami. Snapshot odczytywany po mutexie przy
READ COMMITTED. Wersje i zmiany pozycji zapisują się transakcyjnie.

Uprawnienia owner/manager/operator sprawdzane na serwerze; viewer nie może
preview/apply. Scope event/workspace i aktywność wydarzenia są ponownie
sprawdzane. HTTP ma JSON, Origin/CSRF, ścisłe klucze i limit body 1024 B,
no-store oraz bezpieczne błędy. Przeglądarka nie czyta business tables.
Audyt fair-sort: event/operator, przed/po IDs, timestamp, changed/unchanged.

Dotychczasowe prywatne broadcasty są tylko invalidacją:
dashboard:event:{eventId}:queue i public:session:{token}:queue.
Nie dodano PII, historii, credentials lub podglądu do payloadu, ani pollingu.
Publiczna kolejka używa zapisanych pozycji z API. Test PG kontroluje payloady;
rollback nie zostawia pozycji ani audytu.

## Historia weryfikacji przed Slice 5 Recovery

Poniższa tabela opisuje stan przed Recovery i zachowuje wcześniejsze niepowodzenia.
Aktualny wynik jest w sekcji Recovery poniżej. Logi pod ignorowanym `.artifacts/`;
pliki z poprzednich części zachowano.

| Zakres | Wynik | Dowód |
| --- | --- | --- |
| Review Slice 4 Recovery | 33/33 PASS | slice5-review-slice4-postgres17.log |
| Matematyka po wznowieniu | 18/18 PASS | slice5-engine-resume.log |
| Nowe component/API + stary panel | 61/61 PASS | slice5-components-resume.log |
| Panel po dodaniu canonical-response/stale-refresh | 53/53 PASS | slice5-panel-canonical-tests.log |
| Wczesny typecheck | PASS | slice5-typecheck-progress.log |
| Główna pełna integracja PG17 | 47/47 PASS, 140,73 s | slice5-postgres-full.log |
| W tym nowe Slice 5 | 14/14 PASS | slice5-resume-postgres-fair.log i pełny run |
| W tym fault injection Postgres.js | 22 child workers + business merge child PASS | pełny run i slice4-recovery-{esm,cjs}-*.log |
| DB contention PG17 | 4/4 PASS | slice5-postgres-contention.log |
| DB timeouts PG17 | 3/3 PASS | slice5-postgres-timeouts.log |
| Guest queue regression | FAIL fixture, potem STOP migracji | slice5-postgres-guest.log, slice5-postgres-guest-current-schema.log |
| Next MCP w aktywnym smoke | issues=[], configErrors=[], sessionErrors=[] | odczyt runtime 3105 |
| Browser Fair Queue | 1/1 PASS, 56,3 s; desktop/mobile, Realtime 476 ms | slice5-browser-fair-v3.log |
| Końcowe pnpm test/typecheck/lint/build/diff sekwencyjnie | NOT RUN po STOP | wymagają domknięcia |
| Pełne browser regresje Slice 1–4 | NOT RUN w tej części | wymagają domknięcia |

PG17 races: approve/approve, approve/manual move, approve/start, fair/manual
move, fair/approve, fair/start, fair/restore, merge/fair, done/fair, fair/fair.
Testy wymuszają nakładanie na rzeczywistym lock wait, a nie przypadkowy timing.
Akceptowane są tylko dokładne wyniki dwóch serializacji; loser fair może
otrzymać wyłącznie stale-preview. Sprawdzane 1..N, brak duplikatów/gubienia,
now, scope, RBAC, replay/no-op audit, historia po merge i 2/2. Wstrzyknięty
błąd zapisu audytu wycofuje Fair Insert i Fair Sort wraz z wersjami i pozycjami.

### Przyczyny zatrzymania i wcześniejsze niepowodzenia

Dodatkowa regresja guestSessionQueue zatrzymywała migracje na 0024, następnie
uruchamiała bieżące serwisy generujące kody 6-cyfrowe. Stary CHECK wymagał
8 cyfr: events_session_code_format_check. Uzupełniono tylko testowy etap
przygotowania o 0025–0029, pozostawiając historyczne assertions przed nim.
To ujawniło prawidłowy preflight 0027:

```
Active or scheduled events prevent legacy session-code remediation
SQLSTATE 55000, session_code_legacy_active_event_preflight
```

Fixture wcześniej celowo tworzy aktywne legacy wydarzenie, więc nie może
bezpośrednio przejść takiej migracji. **STOP zgodnie z AGENTS.md: „a migration
fails”**. Nie zmieniono migracji, guardów ani produkcyjnych danych, by ominąć
błąd. Dodany etap testowy pozostaje widoczny i nie jest przedstawiany jako
PASS. Do domknięcia potrzebne rozdzielenie historycznego migration fixture od
runtime fixture bieżącego schematu z zachowaniem wszystkich assertions.
W komentarzu postępu początkowo wskazano 0025; rzeczywisty guard jest w 0027.

Wczesne testy: corrected expectation Fair Insert przy granicy now; oddzielono
duplicate od capacity; merge-race dostał różne songId, by nie testować
zabronionego aktywnego duplikatu. Nie usunięto ani nie osłabiono guardów.
Pierwszy browser filtr zawierający spację na Windows nie znalazł testów;
ponowiono filtrem Fair. Następny run trafił na niejednoznaczny selektor
piosenki występującej także w historii: helper sprawdza teraz konkretnie
nowe pending. Kolejny run odczytał DB podczas optimistic DnD; test oczekuje
teraz kanonicznej odpowiedzi move przed porównaniem zachowania ręcznej
kolejności. To poprawki synchronizacji testu, nie zmiana wymagań.
Dodatkowy agent-browser odczyt nastąpił po zakończeniu serwera smoke i dostał
connection refused; sesję zamknięto. Nie jest to PASS runtime ani hang.

Już uruchomiony browser v3 zakończył się normalnie, exit 0: kilka osobnych
uczestników dołącza przez QR, buduje historię, zgłasza i akceptuje dwie
piosenki, wykonuje rzeczywisty pointer DnD, zachowuje jego rezultat po nowej
akceptacji, otwiera/anuluje podgląd, przechodzi do mobile 390 px bez overflow,
otrzymuje realne 409 po konkurencyjnym operator move i świadomie odświeża
podgląd. Po apply zapis DB odpowiada dokładnym ID z podglądu, panel i publiczny
klient odświeżają się przez Realtime (476 ms). Po start/done nowa piosenka
tego samego uczestnika nie wyprzedza czekającej nowej osoby. Brak nieoczekiwanych
błędów przeglądarki. Błędy sieciowe są pokryte komponentowo; osobny browser
injection awarii komunikacji i pełna regresja poprzednich slice'ów pozostają
do wykonania po rozwiązaniu STOP.

## Pliki Slice 5

- docs/architecture/adr-fair-queue.md
- docs/features/participant-model-slice-5.md
- src/server/fair-queue.ts
- src/server/operator-api/fair-queue-store.ts
- src/server/operator-api/fair-queue.ts
- src/server/operator-api/event-queue.ts
- src/app/api/dashboard/organizations/[organizationId]/events/[eventId]/queue/fair/route.ts
- src/components/operator/event-queue-api.ts
- src/components/operator/event-queue-panel.tsx
- src/components/operator/fair-queue-control.tsx
- tests/fairQueue.test.ts
- tests/vitest/fair-queue-routes.test.ts
- tests/vitest/fair-queue-control.component.test.tsx
- tests/vitest/event-queue-panel.component.test.tsx
- tests/postgres/participantIdentity.integration.test.ts
- tests/postgres/guestSessionQueue.integration.test.ts (oddzielne fixture historyczne/runtime)
- tests/e2e/public-event-session-identity.local.spec.ts

## Migracje, narzędzia i ryzyka

Slice 5 nie dodaje migracji ani schematu. Wszystkie wykonania migracji/testów
dotyczyły disposable lokalnego PostgreSQL 17 lub Supabase Auth PG17.6, nigdy
15/16 ani produkcji. Nie użyto zdalnego Supabase MCP ani usług GitHub/Vercel/
Cloudflare do mutacji. Patch postgres@3.4.9 i rejestracja pnpm bez zmian.

Narzędzia: PowerShell, Python/zip/hashlib, pnpm/Node/Vitest/Testing Library,
TypeScript, Docker PG17, istniejący runner Supabase CLI i Playwright.
MCP: Context7 (Drizzle transaction docs), Next DevTools (routes/kompilacja/
runtime). Odczyt bieżącego changelogu Supabase; brak zmian SDK/config Auth.
agent-browser 0.35.1 użyty dodatkowo, ale próba na zamkniętym runtime nie
stanowi dowodu. Nie było żadnych nowych publikacji ani zdalnych zapisów.

Ryzyka utrzymaniowe po PASS: legacy bez audytu nie ma retroaktywnego waitCredit; historia to obecne
statusy, więc restore usuwa historyczny wkład zgodnie z kontraktem Slice 2.
Nie ma twardej gwarancji czasu wobec ręcznego operatora. Snapshot i audit
są event-sized, bez osobnego cache/job systemu. Zależność patchowana wymaga
dalszego utrzymania według patches/README.md. Istniejąca rozbieżność instrukcji
o liczbie aktywnych publicznych wydarzeń nie została zmieniona przez ten slice.

## Zamknięcie i plan Slice 6

Recovery poniżej rozwiązuje testowy STOP bez zmiany kontraktu 0027.
Wykonano guest regression, browser failure/retry, pełne regresje Slice 1–4
oraz wszystkie wymagane sekwencyjne kontrole projektu. Nie ma otwartych
blokerów ani pominiętych wymaganych bramek. Kopia odtworzeniowa pozostaje
na miejscu; wcześniejsza praca i konfiguracja użytkownika są zachowane.

Slice 6 wyłącznie plan: ADR external songs/YouTube, rozdzielenie zaufanych
danych katalogu od zgłoszonego URL, walidacja hostów i bezpieczna prezentacja,
idempotency i timeouts zewnętrznych metadanych, uprawnienia operatora,
integracja z tym samym uczestnikiem/limitem/mutexem i testy URL/RBAC/Realtime.
Nie implementowano external songs, co-singers ani autoapproval.


## Slice 5 Recovery — konflikt fixture z 0027

Recovery dotyczy wyłącznie przygotowania testów i ich weryfikacji. Przyczyna
nie leżała w Fair Queue ani w migracji. `seedLegacyActiveEvent` w
`tests/postgres/guestSessionQueue.integration.test.ts:274` tworzy świadomie
`status=active`, `closed_at=null`, `ends_at=now()+2h`, z bieżącą sesją i kodem.
Historyczny test instalował schemat do 0021 przed tym seedem, sprawdzał
fail-fast 0022 i zachowanie danych po 0022/0023. Ten scenariusz jest potrzebny:
regresja API sprawdza, że zapisane aktywne legacy event nie blokuje nowego event.

Po 0024 runtime był jednak nieaktualny wobec obecnych sześciocyfrowych kodów.
Dopisanie dalszych migracji do tego samego aktywnego fixture ujawniło 0027.
`drizzle/0027_session_code_6_digits.sql:150` sprawdza zdarzenia inne niż
closed/cancelled bez closed_at, których start lub koniec jest w przyszłości;
linia 163 zgłasza `55000 / session_code_legacy_active_event_preflight`.
Odmowa jest prawidłowym kontraktem, nie regresją do obejścia.

Naprawa:

- Oddzielny historyczny test zachowuje wszystkie dotychczasowe asercje
  0022/0023, następnie stosuje 0024–0026 i oczekuje dokładnej odmowy 0027.
  Porównuje wszystkie eventy, sesje, kody, requesty i definicje constraints
  przed/po; event nadal jest active, closed_at null i ma ośmiocyfrowy kod.
- Bieżący test guest instaluje pełny aktualny łańcuch 0000–0030 **przed**
  seedowaniem aktywnego event. Zachowuje cały scenariusz runtime, współbieżność,
  scope, przejścia statusów i audyt. Nie sztucznie zamyka event i nie pomija
  żadnej migracji.
- Każdy test ma osobny disposable klaster `postgres:17-alpine`. Pierwsza próba
  użycia dwóch baz w jednym klastrze zatrzymała się na prawidłowym guardzie
  0019 `import_job_worker_objects_absent`, ponieważ role są cluster-scoped.
  Ten wariant zarzucono; nie usuwano roli ani nie zmieniano guarda.
- Przejrzano inne fixture kończące historyczną instalację przy 0024.
  Nie znaleziono drugiego analogicznego połączenia aktywnego seedu z 0027;
  nie przerabiano testów celowo sprawdzających starszy schemat.
- Istniejący pełny zestaw 0027 potwierdza również dozwoloną konwersję
  production-shaped legacy data, zachowanie historii i idempotentny canonical
  Drizzle migrate. Obejmuje active/scheduled refusal, pairing, rollback po DDL
  i dwa rzeczywiste wyścigi locków. Nie dodawano fikcyjnej procedury zamykania.

Guard, plik 0027, journal, pozostałe migracje, ADR, kod aplikacji i patch
Postgres.js nie zostały zmienione w Recovery. Początkowy stan hashy zapisano
w `.artifacts/slice5-recovery-baseline.json`; porównanie wykrywa tylko zmiany
powiązanych testów i tego handoffu. `.codex/config.toml` zachowuje hash baseline.
Kopia ZIP nadal istnieje i przechodzi kontrolę integralności.

### Browser Recovery

Test Fair Queue otrzymał osobny describe/fixture, aby nie pozostawiał piosenek
ani historii dla dziewięciu istniejących scenariuszy. Obejmuje też celowy
connection reset podczas preview: komunikat błędu, brak przycisku apply,
niezmienioną bazę, jawny retry, prawidłowy podgląd i cancel bez zapisu.

Pierwsze dwa runy Recovery nie przeszły asercji DnD: trace pokazał
`targetPosition:5`, czyli drop w tło kolumny zamiast pierwszy utwór. Zastąpiono
lokalny gest istniejącym helperem obsługującym scroll i dodano opcjonalny tytuł
źródła, by rozróżnić dwie piosenki tej samej osoby. Sam helper nie wystarczył:
przed gestem ustawiany jest desktop 1440×1800, aby cztery karty były widoczne
jednocześnie; potem wraca 1440×1100 i testuje mobile 390×844. Asercja pierwszej pozycji
pozostała bez zmian. Nie zmieniano DnD aplikacji ani nie osłabiono testu.
Diagnostyka: `.artifacts/slice5-recovery-browser-fair.log` i zachowany trace
`test-results/local-e2e-failures/2026-10-16T07-13-05-152Z` oraz
`2026-10-16T07-16-02-821Z`. Następny run Fair przeszedł 1/1 w 58,5 s,
z Realtime 599 ms i oczekiwanym pojedynczym ERR_CONNECTION_RESET; log
`slice5-recovery-browser-fair-v2.log`. Osobny dotychczasowy test DnD nadal
sprawdza przewijanie, klawiaturę, geometrię overlay, desktop i mobile.


Pełny kolejny run zaliczył Fair Queue i siedem istniejących scenariuszy
uczestnictwa/DnD (8 PASS), ale katalog zakończył się 429, a lifecycle nie
uruchomił się z powodu serial fail-fast. Trace wykazał dokładnie
`SESSION_RATE_LIMITED / Too many connections.`: 33 connect przy 17 pełnych
nawigacjach w ok. 13 s. React Strict Mode tworzy dwa leases przy każdym
pełnym załadowaniu; bazowy limit Presence to 32 nowe połączenia/min/credential.
To konflikt tempa automatycznej fixture z rzeczywistą ochroną, nie błąd Fair Queue.
W tym teście przepuszcza się prawdziwe dokumenty co najmniej co 4500 ms.
Żaden request Presence nie jest pomijany, mockowany ani ignorowany; limity
aplikacji, zegar, dane, błędy i wszystkie wcześniejsze asercje są zachowane.
Log nieudanego pełnego runu: `slice5-recovery-browser-all.log`, trace
`test-results/local-e2e-failures/2026-10-16T07-24-45-298Z`.

W Fair E2E dodano dokładny odczyt kolejności publicznych pięciu utworów przed
apply i po nim. Nie wystarcza już sama obecność wykonawcy: nowe approved
pozycje muszą pojawić się w tej samej kolejności co zatwierdzony preview,
bez ręcznego odświeżania publicznej strony.


Kolejny pełny run po pacingu zaliczył 9/10: katalog przeszedł z kompletem
asercji i bez ignorowania błędów. Ostatni lifecycle zatrzymał się na starym
selektorze: oczekiwał nickname form w dialogu, podczas gdy istniejący join gate
renderuje ten sam nagłówek i formularz w main. Snapshot potwierdził prawidłowy
formularz. Zmieniono wyłącznie scope selektora z dialog na main; oczekiwany
nagłówek, event title, brak searchbox przed join i wszystkie dalsze asercje
pozostają. Log: `slice5-recovery-browser-final.log`, diagnostyka
`test-results/local-e2e-failures/2026-10-16T07-33-54-068Z`.


Izolowany lifecycle po korekcie main przeszedł join, requesty, rename/cancel,
rotację kodu, extension i zamknięcie z poprawnym stanem DB. Potem wykrył
jeszcze stary tekst zamkniętej sesji: `Sesja zakończona` wobec istniejącego
nagłówka `Karaoke dobiegło końca`. Asercja wskazuje obecny nagłówek, zachowując
weryfikację closed/closedAt i braku przycisku Dodaj. Kod produktu bez zmian.
Nieudany log: `slice5-recovery-browser-lifecycle.log`; snapshot/trace
`test-results/local-e2e-failures/2026-10-16T07-36-26-345Z`.


Następny lifecycle wykonał również reopen, ale końcowe oczekiwanie zerowej
liczby błędów nie uwzględniało Presence/beacon ścigającego się z manual close.
Trace potwierdził jedną odpowiedź 403 i dokładny kod `SESSION_EVENT_CLOSED`.
Test zbiera tylko odpowiedzi 403 tej ścieżki, sprawdza body każdej z nich i
porównuje całą listę błędów HTTP/console z dokładnie odpowiadającą im listą.
Inny kod odmowy, inna ścieżka, dodatkowy błąd lub runtime error nadal oblewa
scenariusz. Nie zmieniono guardów ani nie dodano ogólnego ignorowania 403.
Log: `slice5-recovery-browser-lifecycle-v2.log`, trace
`test-results/local-e2e-failures/2026-10-16T07-38-22-357Z`.

### Wyniki Recovery

| Bramka | Wynik | Log w .artifacts |
| --- | --- | --- |
| Guest runtime + historyczna odmowa | 2/2 PASS, 10,67 s | slice5-recovery-guest-isolated.log |
| Pełny zestaw migracji 0027 PG17 | 9/9 PASS, 7,47 s | slice5-recovery-migration0027.log |
| Pełna odpowiednia integracja PG17 | 47/47 PASS, 113,66 s | slice5-recovery-postgres-full.log |
| W tym Fair Queue i 10 wyścigów | 14/14 PASS | ten sam pełny run |
| W tym Postgres.js ESM/CJS fault injection | PASS, wszystkie child workers | ten sam pełny run |
| DB contention PG17 | 4/4 PASS, 25,08 s | slice5-recovery-contention.log |
| DB timeout hierarchy PG17 | 3/3 PASS, 23,27 s | slice5-recovery-timeouts.log |
| Next runtime/kompilacja w aktywnym smoke | configErrors=[], sessionErrors=[], issues=[] | Next DevTools :3105 |
| Pełny browser E2E | 10/10 PASS w jednym runie, 6,6 min; Realtime Fair 427 ms | slice5-recovery-browser-pass.log |
| pnpm test | PASS: Node 391/391, Vitest 597/597 (53 pliki) | slice5-recovery-test.log |
| pnpm typecheck | PASS | slice5-recovery-typecheck.log |
| pnpm lint | PASS, exit 0 | slice5-recovery-lint.log |
| pnpm build | PASS, exit 0; Next 16.3.0 | slice5-recovery-build.log |
| git diff --check | PASS, exit 0, pusty output | slice5-recovery-diff-check.log |

Zmiany Recovery: `tests/postgres/guestSessionQueue.integration.test.ts`,
`tests/e2e/public-event-session-identity.local.spec.ts`, ten handoff. Nie
zmieniano produkcyjnego kodu, migracji ani konfiguracji. Nie było commita,
pusha, deploymentu ani operacji na zdalnej bazie. Izolowany Supabase CLI
weryfikuje wersję PostgreSQL 17 przed lokalnymi migracjami; własne fixture i
kontenery są sprzątane przez istniejący runner. Inne lokalne projekty bez zmian.


Końcowy browser run `slice5-recovery-browser-pass.log` zakończył się exit 0:
10/10 w jednym przebiegu na zweryfikowanym PostgreSQL 170006. Fair Queue:
50,9 s, real public reorder przez Realtime 427 ms; DnD desktop/mobile:
12,4 s; participant/dashboard Realtime: 8,4 s; linking/claim/merge: 43,5 s;
Presence TTL/tabs/reconnect: 1,5 min (offline bez beacon 39990 i 40469 ms);
operator participants: 13,9 s (join invalidation 271 ms); limit 2/2: 15,6 s
(capacity Realtime 440 ms); discovery: 12,3 s; pełny katalog: 1,8 min;
pełny lifecycle: 35,6 s. Nie pozostał skipped/did-not-run ani failed test.
Wcześniejszy izolowany lifecycle także PASS 1/1, 50,7 s. Wszystkie wymagane
browser regresje Slice 1–4 i Fair Queue są ponownie zweryfikowane.


Końcowe kontrole projektu wykonano w wymaganej kolejności na ostatecznym
kodzie: `pnpm test` (391 Node + 597 Vitest, bez skipped), `pnpm typecheck`,
`pnpm lint`, `pnpm build`, `git diff --check` — wszystkie exit 0.
Build skompilował produkcyjne trasy i zakończył generowanie bez błędu.
Wcześniejsze niepowodzenia są opisane powyżej wraz z niezmienionymi logami;
nie są traktowane jako wyniki końcowe. Nie pominięto żadnej wymaganej bramki.

Potwierdzenie zachowania pracy: `.artifacts/slice5-recovery-preservation.json`
wskazuje dokładnie trzy pliki Recovery i zero usunięć względem baseline.
Archiwum odtworzeniowe nadal istnieje, wszystkie 114 plików w ZIP odpowiada
pierwotnym SHA-256. Config użytkownika, patch 3.4.9, rejestracja pnpm,
lockfile, ADR, migracje i journal zachowują hashe wejściowe Recovery.

Werdykt końcowy: **PASS**. Wszystkie wymagane bramki Slice 5 i Recovery są
zweryfikowane. Brak otwartego blockera kodu lub weryfikacji. Pozostają jawne
ograniczenia ADR dotyczące legacy audytu, bieżących statusów historycznych,
ręcznych interwencji operatora oraz utrzymania patchowanej zależności.
Nie rozpoczęto Slice 6 i nie wykonano żadnego zdalnego zapisu.
