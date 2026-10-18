# KUNESTU — P0 Performance Final Mile

Data: 2026-10-18. Baza zmian: `fa9b9b0f9c9219005996c1980ab8386ec7d04d5c`, gałąź `michal-szwindowski/kunestu-p0-performance`. Ten etap nie modyfikuje produkcyjnego kodu `6c6d3f8`. W trakcie weryfikacji właściciel zgłosił samodzielny deployment tego samego SHA do fra1 (`dpl_5HewkFw9SnJ4dBNV1WyX2cXAPVWP`, READY); nie jest to wykonane przez agenta wdrożenie ani zmierzony przez nas wynik regionalny. To raport lokalnego kandydata, nie raport wdrożenia. Użytkownik odmówił deploymentów Preview: przygotowano wyłącznie plan regionalny.

## Potwierdzona przyczyna i poprawka UI

Przy 100 zgłoszeniach profil checkpointu fa9 wykazał 408 wykonań zawartości kart w jednym cyklu ruch/zapis/snapshot. Odtwarzanie intencji kopiowało każdy DTO, wyszukiwania wersji były kwadratowe, a funkcje obsługi akcji oraz element uchwytu DnD zmieniały referencję. Samo memo uchwytu nie pomogło: pierwszy kandydat nadal wykonywał 404 karty i uzyskał p95 198,3 ms. Ta nieudana próba została zachowana; nie zaliczono jej.

Poprawka zachowuje referencje niezmienionych wierszy podczas replay i kolejnych snapshotów, zastępuje powtarzane find/findIndex mapami i stabilizuje funkcje akcji. Porównanie całego JSON DTO uwzględnia także historię nicków, metadane uczestnika i przyszłe pola; nie opiera się wyłącznie na wersji zgłoszenia. Zmienny uchwyt DnD pozostał w tym samym elemencie article, natomiast kosztowna zawartość karty jest memoizowana. Nie zmieniono sensorów, collision detection, auto-scroll, pozycji before/after, reguł konfliktu, kontroli uprawnień ani Fair Queue.

Profil końcowego podejścia: 6 wykonań zawartości kart na ruch dla 20/50/100, po 10 próbek. DnD wrapper nadal reaguje na kontekst; nie ukrywamy jego pracy jako zera renderów. Przy 100 kartach mediana ScriptDuration na cały obserwowany cykl spadła 245,6→91,5 ms, LayoutDuration 47,6→9,0 ms, RecalcStyleDuration 19,2→5,8 ms. Są to sumy pracy w cyklu aż do synchronizacji, a nie lokalny input latency. Pomiary CDP/probes mają narzut i służą diagnozie.

## Niezależny pomiar bez profilera — PASS

Zachowany przebieg zakończył się 2026-10-18 o 13:57:26 UTC; nie uruchomiono go ponownie tylko z powodu przerwania sesji. Zoptymalizowany Next.js 16.3.0 build + next start, Windows, Node 24.19.0, Ryzen 7 5700X3D, 16 logicznych CPU, 32 GiB RAM, headless Playwright Chromium. Lokalny Supabase z Auth/Realtime i PG17, syntetyczne wydarzenie, dwie niezależne sesje przeglądarki zalogowane na to samo konto operatora (osobne urządzenia/outboxy). Regresje odrębnych kont obejmuje dodatkowy zestaw Collaboration. Bez profilera, throttlingu CPU i sztucznej latencji sieci. Po 100 naprzemiennych przesunięć przyciskiem, ten sam wiersz; 300/300 operacji. Ten pomiar nie jest benchmarkiem 100 gestów pointer DnD ani testem fizycznego tabletu.

| Zgłoszenia | UI p50/p95/p99 ms | HTTP ack p50/p95/p99 ms | Drugi panel p50/p95/p99 ms | Maks. drugi panel ms |
|---|---|---|---|---|
|20|10,3 / 29,7 / 36,2|230,1 / 277,3 / 292,0|295,4 / 348,9 / 381,7|404,3|
|50|12,6 / 19,1 / 25,8|253,6 / 309,8 / 353,3|346,3 / 411,5 / 476,5|531,6|
|100|22,6 / 36,3 / 41,6|326,9 / 457,1 / 581,6|506,5 / 672,0 / 773,5|809,0|

Budżety lokalne: UI p95 ≤100 ms; peer p95 <2 s, max ≤5 s. Wszystkie przechodzą. Percentyle nearest-rank; p99 przy n=100 jest jedną obserwacją ogona, nie gwarancją SLA. Czas UI obejmuje click→pierwszy RAF z widoczną zmianą tekstu, bez sieci. HTTP/peer mierzone zegarem monotonicznym koordynatora od początku czynności Playwright, obejmują także jego obsługę lokatorów. Zgodność kolejności dwóch paneli sprawdzana przez polling testowy 10/25/50/100 ms (nie polling produktu); wynik jest górnym oszacowaniem chwili zauważenia. Osobno każda iteracja sprawdza render z potwierdzonym operationId/requestId/revision i bez pending intents.

Profil fa9 z tego samego środowiska miał lokalne p95 28,3/47,4/88,0 ms przy n=10; wcześniejsze dwie próby raportu incydentu przekraczały 100 ms (około127 ms). Zmienność bazowego wyniku jest jawna. Nie porównujemy 10 profilowanych próbek z 100 natywnymi jako identycznej metodologii. Bezpośrednie porównanie profil→profil i liczba wykonań kart potwierdzają usunięcie nadmiarowej pracy.

Dowody: `docs/verification/p0-final-mile-performance-2026-10-18.json`; surowe profile i logi w zachowanym `.artifacts/p0-final-mile-*`. Wrapper profilujący zapisuje/przywraca dokładne bajty plików i potwierdza SHA-256. Probes nie trafiają do aplikacji.

## Trwała diagnostyka P0

POST /queue/sync po walidacji wiąże operation_id z serwerowym request_id. Istniejące etapy autoryzacji/mutexa, mutacji, receipt/audytu, snapshotu i commitu zachowują ten kontekst. Nie loguje się payloadu, nicków, tokenów, pełnych tras sesji ani treści wyszukiwania. Idempotency i receipt pozostają w tej samej transakcji co mutacja.

Istniejący wpis audytu potwierdzenia otrzymuje originRequestId i queueRevision. Snapshot, po pełnej autoryzacji wydarzenia, może zawierać opcjonalny trace trzech identyfikatorów. Trace jest dostępny tylko wtedy, gdy rewizja wpisu odpowiada bieżącej rewizji strumienia. Nowa zmiana legacy, Fair Sort lub Identity nie jest przypisywana starej operacji. Replay zachowuje pierwotny identyfikator zapisu. Brak historycznej metadanej daje null, nie błąd. Wpis potwierdzenia używa clock_timestamp(), ponieważ domyślny czas rozpoczęcia transakcji może poprzedzać czas późniejszego domain audit. To metadane istniejącego audytu; brak migracji/nowej tabeli i brak dodatkowej wymiany SQL.

`window.kunestuQueueDiagnostics.report()` udostępnia wyłącznie pamięciowy rejestr maks.128 rekordów /30 minut: local, realtime, snapshot/stale_snapshot i rendered. Scope jest losowy dla kontrolera, nie jest identyfikatorem uczestnika ani urządzenia. Rejestr nie wysyła danych ani nie zapisuje ich w storage. Realtime pozostaje sygnałem invalidation, bez rozszerzania payloadu. Render jest potwierdzany po commit React i RAF, z jawnym pending; usunięcie overlay przy tej samej rewizji może wygenerować drugi, rozróżniony rekord. Stare snapshoty nie obniżają rewizji. Koaleskowane rewizje nie gwarantują pokazania każdej pośredniej kolejności. Zegary urządzeń nie służą do dokładnego pomiaru jednokierunkowej latencji.

Search otrzymuje wyłącznie bucket długości, liczby tokenów, informację o cursor i kwalifikacji fuzzy/engine. Nie zapisujemy zapytania, jego hasha ani zawartości kursora. Fuzzy eligible nie oznacza wykonania gałęzi SQL. Dla legacy kwalifikacja jest zawsze true dla dopuszczonego zapytania; to odzwierciedla istniejący SQL.

## Search 57014 — ograniczenie nadal otwarte

Historyczny log produkcyjny potwierdza DB_STATEMENT_TIMEOUT w unicode-v2 po 2572,6 ms, po osobnym lookup sesji189,6 ms. Nie zawiera frazy ani planu anulowanego wykonania. Poprawne indeksy i statystyki udanych zapytań nie dowodzą planu tej porażki. Lokalne wcześniejsze testy odtworzonego publicznego katalogu 92 014 rekordów nie odtworzyły błędu; ich starych dat nie zmieniono.

Limit PostgreSQL 2 s pozostaje bez zmian. W protokole rozszerzonym może obejmować okres od Parse/Bind/Describe do Execute/Sync; nie można utożsamić2572,6 ms całego serwisu z samym wykonaniem SQL. [Dokumentacja PG17](https://www.postgresql.org/docs/17/runtime-config-client.html). Nie zmieniono rankingu, fuzzy, kandydatów, normalizacji ani paginacji. Dodatkowe bezpieczne shape/phase logs zawężą przyszły incydent dopiero po osobno autoryzowanym wydaniu; nie stanowią już wykonanego pomiaru produkcyjnego. Dokładna przyczyna timeoutu pozostaje nieustalona.

## Region — plan, bez wdrożenia

Wcześniejsza odczytowa inspekcja Vercel potwierdziła READY/iad1 dla `dpl_4YxXwaAFhks3tDs1HLEQ5KKwJzCH`. Następnie właściciel zgłosił nowy READY/fra1 dla tego samego produkcyjnego SHA (`dpl_5HewkFw9SnJ4dBNV1WyX2cXAPVWP`). Ten zewnętrzny krok zmienia stan produkcji; starsza inspekcja nie jest dowodem aktualnego regionu. Nie ma wdrożonego lokalnego kandydata fa9 z optymalizacją UI. Ukryty Preview DATABASE_URL nie dowodzi izolacji. Właściciel odmówił deployów Preview; nie wywołano tych środowisk. Plan w `docs/runbooks/p0-regional-comparison.md` obejmuje oddzielną bazę, identyczny SHA, ≥100 operacji, rozdzielenie pool/BEGIN, mutex/wire/SQL/commit, metryki dwóch paneli, koszty i rollback. Aktywny vercel.json pozostaje bez zmiany.

Lokalne porównanie faz fa9→kandydat zachowuje 27/24/22/20/12/8 instrukcji SQL dla placement/approve/start/done/replay/snapshot. Niewielka różnica pojedynczych czasów nie jest dowodem przyspieszenia backendu. Subquery trace zwiększa pracę PostgreSQL, ale nie liczbę round-tripów. Liczba instrukcji SQL nie jest liczbą fizycznych pakietów ani zawsze liczbą sekwencyjnych wymian: istnieje pipelining. Próba faz z shimem TCP daje jedną próbkę na akcję, nie p50/p95/p99 ani czysty czas SQL. Brak pomiaru produkcyjnego p50/p95/p99 i brak wiarygodnego rozdzielenia kosztu sieci w iad1/fra1. Wcześniejsza kalibracja opóźnienia nadal nie spełniała5 s peer; nie anulowano tego wymagania.

## Weryfikacja końcowa

Aktualne wyniki (daty i logi zachowane):

- `pnpm test`: Node430/430, Vitest757/757 — PASS; po ostatniej korekcie diagnostyki dodatkowy targeted64/64 — PASS.
- `pnpm typecheck`, `pnpm lint`, `git diff --check` — PASS. Pierwszy lint objął wygenerowane `.next-p3-e2e` i zachowane `.artifacts`:1272 błędy/17454 ostrzeżenia, bez błędów w src. Dodano wyłącznie wykluczenia katalogów generowanych i logów; nie wyłączono reguł kodu aplikacji. Pierwotny log pozostał zachowany.
- Samodzielne `pnpm build` — FAILED przed kompilacją: brak `.env.local` w tym worktree. Nie kopiowano prywatnych zmiennych. Czyste `pnpm build` w istniejącym izolowanym runnerze z tymczasową konfiguracją lokalnego Supabase — PASS; bez zmiany plików env.
- PG17 Collaboration/Fair Queue/migracja prezentacji:27/27; Identity/discovery/catalog/driver faults:54/54; Realtime RLS0035:1/1; Unicode quality:1/1; Search admission/security:2/2; legacy quality/SQL/API/UI:2/2; contention:4/4; hierarchy timeouts:3/3; fazy kolejki:1/1 — PASS. Wszystkie harnessy są lokalne, z własnymi kontenerami; brak połączenia testów z produkcją.
- Pełny zoptymalizowany browser E2E:40 PASS,1 SKIPPED,12,7 min. Zakres: Collaboration, niezależne i sprzeczne decyzje, outbox/offline/401, Fair Queuev2 i legacy, Identity/merge/nicknames, gestures/keyboard, Presence, Realtime reconnect/token renewal/no-polling, RLS A/B, Search PL/EN/UK, recovery/errors/theme. Test `Realtime expiry drain` wymaga oddzielnego short-JWT środowiska i został pominięty; `Realtime suspend drain` przeszedł wyłącznie lokalnie. Nie wykonywano produkcyjnego suspend/resume. Fixture wrapper potwierdził przywrócenie layoutu i usunięcie obu tymczasowych tras, exit0 o14:14:22 UTC.
- Po pomiarze300 operacji wzmocniono wyłącznie diagnostykę renderu: sygnał pending musi odpowiadać widokowi React przechwyconemu przy commit, nie zmienionemu później stanowi transportu. Test negatywny odrzuca taki wyścig. Dodatkowy świeży browser smoke po tej korekcie:3/3 PASS, po10 operacji przy20/50/100, z kontrolą identyfikatorów i rewizji w drugim panelu. To walidacja końcowej diagnostyki; oryginalny niezależny benchmark ma nadal100 próbek na rozmiar. Pierwotne300 wyników nie są ponownie datowane ani zastępowane krótką próbą.

Testy fizycznego tabletu, produkcyjne E2E/mutacje i rzeczywisty regionalny A/B nie zostały wykonane. Emulowany dotyk nie jest fizycznym urządzeniem. Poprzednie pełne benchmarki katalogu i SQL zachowują stare daty; nie odtwarzano ich bez zmiany SQL.

## Ryzyka, wydanie i rollback

Lokalny budżet UI został spełniony. Brak pomiarów regionalnych i nieodtworzony dokładny przypadek57014 blokują ogólne GO dla hotfixu wydajnościowego. Nie ma zaakceptowanego odstępstwa od budżetów. Nie przedstawiamy testów funkcjonalnych jako dowodu ich spełnienia w produkcji.

Kandydat nie wymaga migracji. Przed przyszłym wydaniem potrzebne są osobna autoryzacja i decyzja o brakującym dowodzie regionalnym/diagnostycznym. Zachować poprzedni READY deployment, domeny i kompatybilny schemat. Przy autoryzowanym rollbacku użyć standardowego poprzedniego deploymentu Vercel, bez ręcznych aliasów/DNS i bez cofania danych/receipts. Powrót wyszukiwarki do legacy to osobna zatwierdzona zmiana flagi; nie jest wykonywany automatycznie.

Agent nie wykonał push, deploymentu, zmian produkcyjnej bazy, restartu ani suspend/resume. Zmianę regionu wykonał niezależnie właściciel. Dane testowe powstają wyłącznie w jednorazowych lokalnych harnessach. Prywatna konfiguracja, stare backupy, checkpoint fa9 i dwa niezwiązane raporty wydania pozostają poza tym checkpointem.


## Werdykty i checkpoint

| Bramka | Wynik |
|---|---|
| Lokalny UI20/50/100, niezależne300 operacji | PASS |
| Zredukowana liczba renderów i zgodność kart/uchwytów | PASS w opisanym profilu; brak fizycznego tabletu |
| Korelacja zapisu/receipts/revizji/peer-render i negatywne przypadki | PASS lokalnie |
| Regresje funkcjonalne i bezpieczeństwa PG17/Node/Vitest | PASS |
| Pełny E2E |40 PASS/1 jawny SKIPPED; końcowy diagnostic smoke3 PASS |
| Build/typecheck/lint/diff | PASS w izolowanej konfiguracji; zwykły build bezenv jawnie FAILED |
| Rzeczywiste iad1/fra1 i wpływ samego regionu | NOT MEASURED; nowy fra1 zgłoszony przez właściciela |
| Dokładny produkcyjny przypadek57014 | PARTIAL: potwierdzony timeout, brak frazy/planu |
| GO dla wydania hotfixu wydajnościowego | NO-GO do uzyskania brakującego dowodu lub jawnej decyzji właściciela |

Lokalny checkpoint: `perf: reduce queue card rendering and correlate committed operations`, bez pusha. Manifest i SHA-256: `docs/verification/p0-final-mile-manifest-2026-10-18.json` (manifest nie hashuje samego siebie). Lista obejmuje tylko ten etap; brak `.env`, `.codex/config.toml`, `.artifacts`, backupów, danych, migracji, konfiguracji regionalnej oraz dwóch wcześniejszych raportów wydania.

Wykorzystano projektowe skille frontend/backend/testing/realtime/security/ops i Postgres best practices; oficjalne lokalne dokumenty Next16.3 oraz dokumentację PG17/Vercel dla interpretacji timeoutów i planu regionów. Narzędzia: Git, Node/pnpm, TypeScript/ESLint, Docker PG17, lokalny SupabaseCLI, Playwright/CDP. Wcześniejsze odczytowe VercelMCP sprawdziło metadane projektu/deploymentów/env (bez ujawniania wartości); nie użyto SupabaseMCP, GitHub ani mutacji usług zdalnych w tym etapie. Późniejsza weryfikacja Frankfurtu wymaga odrębnego odczytu aktualnego deploymentu, a zapisy — nowej zgody.
