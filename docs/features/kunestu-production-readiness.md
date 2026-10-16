# Kunestu — końcowa integracja i gotowość produkcyjna

Data: 2026-10-16, Europe/Warsaw. Źródło: bieżący lokalny worktree po [audycie integracji](post-i18n-unicode-integration-audit.md), bez Vercel Preview.

## Wykonanie autoryzowanego release — aktualizacja 2026-10-16

Poniższy audyt NO-GO opisuje wcześniejszy stan dostępu. Właściciel następnie autoryzował commit/push, migracje, ręczny backup/restore, Production deploy bez Preview i aktywację Unicode po weryfikacji. Właściciel jednoznacznie wskazał `qwmimnhdnzqfckswxjww` (`poza-nuta-development`) jako jedyną bazę aktywnego Vercel `pozanuta`. Nie twierdzimy, że odczytano wartości Sensitive. Odczyt metadanych Supabase oraz natywne połączenie sesyjne TLS z weryfikacją CA i hostname potwierdziły ref, PostgreSQL 17.6, rolę postgres i zgodność 28 hashy/timestampów journalu. Do zastosowania na tej bazie pozostają 0028–0031.

**Ręczny backup i rzeczywiste odtworzenie: PASS.** Jeden eksportowany snapshot REPEATABLE READ READ ONLY, PostgreSQL 17 pg_dump custom + pg_dumpall ról bez haseł. Dane i schemat Auth/public/storage/private/realtime/vault oraz journal zachowano. 68 tabel: wszystkie liczniki i skróty każdego wiersza zgodne po odtworzeniu; 242 constraints i 33 role z atrybutami zgodne. Cztery CHECK zostały ponownie sparsowane w wycofanej transakcji klonu: PostgreSQL przy logicznym restore spłaszcza zagnieżdżone AND; definicje po parsowaniu są identyczne. Nie pominięto różnic relacji ani danych. Przy restore właściciela zarządzanego event triggera tymczasowy SUPERUSER dotyczy wyłącznie roli postgres w odizolowanym klonie; oryginalne atrybuty przywrócono i porównano.

Backup leży poza repozytorium, w katalogu `kunestu-prod-20261016-XqKlcD` w prywatnym katalogu backups właściciela. Pliki są szyfrowane AES-256-GCM z losowym nonce per plik; klucz chroni Windows DPAPI CurrentUser, ACL dopuszcza bieżącego użytkownika i SYSTEM. Sprawdzono odszyfrowanie klucza, uwierzytelnienie GCM oraz SHA-256. Zachować `key.dpapi` i dostęp do tego konta/systemu Windows; bez osobnego escrow nie jest to kopia odporna na utratę całego komputera/konta. Nie zapisano jawnego dumpa ani danych użytkowników do repozytorium/logów.

Klon: Supabase PostgreSQL 17.6, RAM/tmpfs, network=none, bez opublikowanych portów i dostępu do produkcji. Kopia obejmuje 92 014 utworów, 43 wydarzenia, 1066 zgłoszeń oraz 1 rekord Auth; wartości osobowe nie są publikowane. Storage: 0 bucketów i 0 obiektów; nie ma plików do odrębnego backupu i nie mylimy metadanych DB z zawartością Storage. Edge Functions: 0; Vault secrets: 0. Odczyt ustawień publicznych Auth 200, ich kopia i materiał odtworzeniowy są zaszyfrowane. Odtworzenie dotyczy DB w tym samym zarządzanym projekcie: ustawienia OAuth/SMTP, klucze podpisujące i konfiguracja usług pozostają po stronie dostawcy; nie certyfikujemy rekonstrukcji nowego projektu Supabase. Hasła ról zarządzanych nie są elementem pg_dumpall; w odzyskiwaniu wymagają zachowania istniejącej konfiguracji lub zatwierdzonego ustawienia poświadczeń.

Dowody i dokładne ścieżki są w prywatnym manifest.json/restore-verification.json backupu oraz ignorowanych `.artifacts/production-backup-restore-result.json`. Próby restore wykazały wymagane uprawnienia event triggera, zakończenie inicjalizacji obrazu oraz normalizację reprezentacji CHECK; poprawiono procedurę klonu, bez zmian produkcyjnego schematu lub osłabienia kontroli danych.

Migracje 0028–0031 przeszły na rzeczywiście odtworzonych danych (32 wpisy journalu, 92 014 source songs bez zmian, nowe projekcje puste). Pierwsza próba ujawniła brak konfiguracji dostawcy w klonie: supautils.policy_grants i session_preload_libraries oraz właściciel bazy postgres. Odczytano je na źródle, dołączono do szyfrowanej kopii i odtworzono wyłącznie w klonie; nie zmieniano migracji ani produkcyjnych ról/RLS. To konfiguracja pozwalająca postgres zarządzać politykami realtime.messages bez zmiany właściciela tabeli. Przed produkcyjną migracją pozostaje sprawdzenie aktywności/blokad i przygotowanie kompatybilnego rollbacku. Stary deployment `dpl_5AoJwKwTzNasiVVF7pEDAHo4xUcc` (SHA `9d1fd059c33c28d5679d4ba40037c3897285bb9d`) jest READY, ale po nowych merge nie jest bezpiecznym rollbackiem. Kompatybilny dodatkowy artefakt awaryjny należy przygotować z checkpointu `721a1dd35caec0666d099024a344628c6e075c1c`, który obsługuje aliasy uczestników. Używa Production env bez przypisania domen (skip-domain), nie Preview. Początkowy release pozostaje legacy; aktywacja unicode-v2 ma osobną walidację i wymaga redeploymentu. Cofnięcie Vercel nie cofa SQL ani danych.

## Werdykt audytu sprzed wykonania release

| Obszar | Werdykt | Dokładny zakres |
| --- | --- | --- |
| Enterprise DnD | PASS lokalnie | Pełne optimized-build E2E, desktop, keyboard, emulowany touch, transakcje i rzeczywiste konflikty PG17; bez certyfikacji fizycznego tabletu |
| Publiczne i18n | PASS lokalnie | PL/EN/UK, independent preferences, fallback EN, błędy, 2/2, Presence, Realtime, aktualne browser testy i źródłowe pokrycie |
| Unicode Search P0 | PASS lokalnie | Oba silniki, 13 452 przypadki JS/SQL, oryginalne pisma, browser 54 zapytania z tym samym rankingiem PL/EN/UK |
| Dashboard PL — zakres wydania | PASS lokalnie w sprawdzonym zakresie | Pełne działania operatora E2E w PL. EN dashboardu i pełna administracja nie są kryterium obecnego wydania; dotychczasowe katalogi i kod EN zachowano |
| Integracja całości | PASS dla wykonanej lokalnej macierzy | Uruchomione testy obejmują wspólny obraz kodu; nie oznacza to wykonania native-device ani produkcyjnych scenariuszy |
| Production readiness | **NO-GO / BLOCKED** | Brak świeżych dowodów produkcyjnego schematu, backup/restore, kompatybilnego rollbacku i izolacji testów online |

Nie ma nierozwiązanego błędu aplikacji stwierdzonego w zakończonej lokalnej macierzy. Korekta właściciela: kryterium dashboardu to PL; brak pełnej akceptacji EN dashboardu nie blokuje tego wydania. Historyczne wyniki pozostają bez zmian i nie otrzymują nowej daty wykonania. Blokery produkcyjne są od nich niezależne. Nie ma świeżego, zweryfikowanego dostępu do produkcyjnej konfiguracji, historii migracji, backupu/restore ani identyfikacji kompatybilnego artefaktu rollbacku. Brak dowodu nie jest potwierdzeniem, że backup lub migracja nie istnieje.

Nie wykonano commita, stagingu, pusha, deploymentu, zdalnej migracji, zdalnego backfillu ani produkcyjnych testów zapisujących. Testy SQL używały wyłącznie owned PostgreSQL 17. `.codex/config.toml` i checkpoint `721a1dd35caec0666d099024a344628c6e075c1c` pozostają chronione.

## Zakres i faktyczne zmiany tego przebiegu

Nie przebudowywano DnD, normalizacji, matematyki Fair Queue, Auth ani i18n. Dodano brakującą możliwość weryfikacji istniejącej pełnej suity E2E na zoptymalizowanym buildzie:

- `tests/e2e/run-local-supabase-smoke.ts`: jawne `LOCAL_E2E_OPTIMIZED=1`, budowa zoptymalizowanej aplikacji i przekazanie lokalnego trybu do konfiguracji, niezależnie od benchmarku. Istniejące guards targetu i czyszczenie dziedziczonych credentials zachowano.
- `playwright.local-supabase.config.ts`: zwykła pełna suita może używać `next start`; jawny PL dla polskich selektorów.
- `playwright.queue-performance.config.ts`: jawny PL dla istniejących polskich selektorów; benchmarku DnD nie uruchamiano ponownie.
- `tests/e2e/public-event-session-identity.local.spec.ts`: naprawa potwierdzonych przestarzałych selektorów `Close toast` i dwóch `Close` na aktualne polskie ARIA „Zamknij powiadomienie” / „Zamknij”, a także poprawne ICU „32 piosenki” zamiast dawnego „32 piosenek” w katalogu. Zarządzanie uczestnikami czeka na jedną aktywną planszę, subscribed Realtime i jeden pasujący wiersz przed interakcją. Nie wybiera arbitralnego `.first()`. Asercje zamknięcia toastu/dialogów, unikalności wiersza, 2/2 i poprawnej nawigacji pozostały.
- `tests/e2e/internationalization.local-smoke.mjs`: usunięto jedną końcową spację w pustej linii 55, znalezioną dopiero przez whitespace check wszystkich untracked kandydatów. Tokeny kodu/asercje są niezmienione; `node --check` PASS. Nie powtarzano mutującego scenariusza dla tej wyłącznie whitespace poprawki; wcześniej wykonana kopia ma identyczną logikę.

Pierwszy zoptymalizowany run zakończył się timeoutem na selektorze toastu: 1 FAIL, 11 NOT RUN, 1 PASS (theme). Trace zachowano w `test-results/local-e2e-failures/2026-10-16T15-22-21-240Z`. Drugi run przeszedł Fair Queue i kolejne scenariusze, po czym wykrył przestarzały `Close` w linkowaniu: 1 FAIL, 8 NOT RUN, 4 PASS; trace `2026-10-16T15-30-26-602Z`. Przegląd pozostałych literalnych nazw wykrył drugi analogiczny selektor w merge dialogu i został on poprawiony przed kolejnym runem. Trzeci run: 9 PASS, 1 FAIL, 3 NOT RUN, trace `2026-10-16T15-40-41-993Z`; snapshot katalogu potwierdził poprawne „Rock, 32 piosenki”, podczas gdy test nadal oczekiwał dawnej nieodmienionej etykiety. Nie były to dowody błędnego zapisu kolejki, linkowania lub niepoprawnej odmiany w aplikacji. Nie zwiększano timeoutów, nie dodawano retry i nie usunięto kroków. Pełny run po poprawkach ma osobny log.

Czwarty run: 6 PASS, 1 FAIL, 6 NOT RUN, trace `2026-10-16T15-46-16-182Z`. Unscoped locator przy pierwszym otwarciu kolejki dopasował dwie reprezentacje DOM tego samego request ID. Test otrzymał jawny scope do widocznej planszy oraz oczekiwanie na Realtime i count=1; dwa aktywne wiersze nadal spowodują błąd. Nie potwierdzono duplikacji rekordów DB ani zmiany logiki aplikacji. Skupiony scenariusz po poprawce: 1/1 PASS, 11,9 s, join invalidation 148 ms (`readiness-e2e-management-focused-second.log`). Pierwsza próba grep ze spacjami zakończyła się „No tests found”, bez wykonania testu; nie jest PASS. Udana próba użyła jednoznacznego `manages`. Wcześniejsze wyniki/trace zachowano.

## Środowiska i granice testów

- Pełna suita E2E: nowy disposable Supabase `pozanuta-stage1-e2e-isolated`, Auth/Realtime/PG17.6, API 55431, DB 55432, aplikacja 3105; tryb optimized build + `next start`, trace on, jeden worker, zero retries. Migracje i fixture wykonują zapisy wyłącznie tam; sprzątanie dotyczy własnego stacka i sprawdzonych katalogów output. Sąsiedni `pozanuta-social` pozostał nietknięty.
- Publiczne i18n/Unicode/management smoke: istniejący syntetyczny owned dev stack 55521/55522 (PG17.6), zarządzany launcher na 3000. Serwer z wcześniejszego przebiegu został zastąpiony świeżym, jawnie uruchomionym z tego repo launcherem z `SONG_SEARCH_ENGINE=unicode-v2`. Przy pierwszej próbie dodatkowa atestacja odmówiła wykonania smoke, bo ścieżki starego procesu były względne; nie uruchomiła żadnych mutacji. Nowy proces ma zweryfikowaną ścieżkę repo/launcher i konkretny PID.
- Integracje DB: oddzielne kontenery `postgres:17-alpine`, losowe hasła i przypisane loopback ports; rzeczywisty silnik 17.10. Nie uruchamiano PG15/16.
- Chromium 149.0.7827.55. Mobile to viewport/CDP/iPhone13 emulation, **nie fizyczny tablet ani Safari/iOS**.
- Root local env nie zostały zmienione. Przeglądarki blokują ruch poza loopback. Synthetic operator credentials i trace pozostają ignorowane/prywatne.

Istniejące standalone smoke skopiowano wyłącznie do ignorowanych runnerów `readiness-*`, zmieniając prefiksy wyjściowych artefaktów, a nie wejścia i asercje. Pochodzenie/hash: `.artifacts/readiness-browser-runner-provenance.json`. Ich zapisy to nowe syntetyczne osoby/requesty/Presence, zatwierdzenie dwóch requestów bieżącego i18n runu i anulowanie własnego UK requestu. Nie edytują wcześniejszych uczestników ani ich zgłoszeń. Nie są runnerem do produkcji.

## Wyniki aktualnych testów

Wszystkie poniższe wyniki wykonano w tym przebiegu 2026-10-16. Zachowane wcześniejsze raporty są historyczne i nie zastępują tych uruchomień.

| Kontrola | Wynik | Nowy log w `.artifacts/` |
| --- | --- | --- |
| `pnpm test` | 414/414 Node + 679/679 Vitest, 57 plików, zero failures/skips | `readiness-verified-test.log` |
| Typecheck/lint/build/diff-check | **PASS**, wszystkie exit codes 0; końcowy ciąg zakończony 18:06 czasu polskiego | `readiness-verified-{typecheck,lint,build,diff-check}.log`, `readiness-verified-exit-codes.json` |
| PG17 participants/Slice1–5/DnD/driver | 54/54, pięć plików, 183,31 s | `readiness-postgres-participants.log` |
| PG17 contention | 4/4, 21,29 s | `readiness-postgres-contention.log` |
| PG17 timeout hierarchy | 3/3, 17,49 s | `readiness-postgres-timeouts.log` |
| Search legacy quality + SQL/API/UI | 2/2, 14,02 s | `readiness-search-legacy.log` |
| Search unicode-v2 quality + SQL/API/UI + adversarial | 3/3, 103,52 s | `readiness-search-unicode-quality.log` |
| Unicode migration/parity/import/backfill/scale + timeout/restricted importer | 2/2, 120,51 s | `readiness-search-unicode-postgres.log` |
| Pełne E2E na optimized build | **13/13, 6,0 min, zero retries**, jeden kompletny przebieg | `readiness-e2e-optimized-final.log` |
| Publiczne i18n PL/EN/UK | 22/22; runtime errors 0; pięć oczekiwanych 409/500, external requests 0 | `readiness-i18n-public.log` |
| Negocjacja/fallback/persistence | 12/12; bez mutacji | `readiness-final-locale.log` |
| Management PL/EN core | 12/12; odczyty organizacji/kolejki/uczestników; Auth synthetic sign-in | `readiness-final-management.log` |
| UK negative/touch | 4/4, zero join mutations | `readiness-final-negative.log` |
| Browser Unicode | 9/9 grup, 54 wyszukiwania, runtime errors 0, external requests 0 | `readiness-unicode-browser.log` |

Pełny E2E trace: `test-results/local-e2e-failures/2026-10-16T16-01-50-881Z` (nazwa katalogu jest wspólnym mechanizmem retencji, run był udany). Fresh Realtime: Fair Sort → public refetch 682 ms; join Presence online 258 ms; participant-management invalidation 101 ms; 2/2 capacity update 176 ms; offline TTL bez beacon około 40,3 s. To pojedyncze pomiary lokalne, nie SLA produkcji. Enterprise desktop 18,6 s, emulowany touch 4,6 s; szeroki mouse/keyboard desktop/mobile 17,4 s.

Ostatnie szybkie smoke 12/12/4 wykonano także na świeżo zbudowanym root runtime. Nie przepisano starych i18n/browser wyników: nowe prefiksy `readiness-*` i `readiness-final-*` zachowują obie serie. Runtime aplikacji był budowany z niezmienionych źródeł aplikacyjnych; późniejsze poprawki dotyczyły testów, a końcowe statyczne bramki sprawdzają ich aktualny stan.

Po ostatnim buildzie z 18:06 ponownie uruchomiono zarządzany lokalny runtime z v2. Read-only public search `光` zwrócił 200 i oryginalny tytuł; ponowione browser smoke 12/12/4 mają prefiks `readiness-postbuild-*`, bez runtime errors i bez join mutations. Pierwszy pomocniczy probe Node odrzucił mieszankę CommonJS/top-level await przed wykonaniem żądania; poprawiono format skryptu na ESM i ponowiono go skutecznie. To nie był błąd aplikacji.

Pierwszy ciąg końcowych kontroli został przerwany przed utworzeniem logu builda; utracony uchwyt procesu narzędzia nie został uznany za PASS. Powtórzono cały typecheck/lint/build/diff-check, zapisując exit code i UTC każdej komendy do pliku. ESLint zachowuje wcześniejsze wykluczenia `tests/**` i `scripts/**`; lint PASS nie oznacza lintowania tych plików. Ich typy i zachowanie sprawdzają odpowiednio TypeScript i wykonane testy.

Nowy test 100k potwierdził 61 top-five przypadków, sześć aliasów i 13 452 JS/SQL porównania. Wybrane mediany/sample p95: `Dancing Queen` 26,62/35,10 ms, `周` 88,75/120,47 ms, `光` 10,26/18,51 ms, `Fixture Song 90000` 664,99/771,04 ms; 20 równoległych zapytań 467,36 ms całej paczki, osiem ciężkich 3582,32 ms. Wykonywano równolegle inne testy na tym hostcie; wyniki nie są czystym porównaniem wydajności lub gwarancją produkcyjnego p95.

## DnD, Fair Queue, identity i Realtime

Kontrakt pozostaje: jeden model slotu lane + 1-based position po usunięciu źródła; rzeczywiste połowy kart określają BEFORE/AFTER. Ten sam slot renderuje indicator i trafia do API. Poza body/viewportem drop jest anulowany; pending/rejected nie otrzymują fikcyjnej ręcznej kolejności.

Placement waliduje uprawnienia, event/workspace, lifecycle i expectedRevision po event/session mutexie. Status, pozycje, wersje i audit należą do jednej transakcji. Nieaktualny zamiar daje 409 bez replay. Realtime jest sygnałem refetch; zmiana revision anuluje gest, a stare mouse-up nie może zapisać. Rejected wymaga confirm; cancel nie zapisuje. Zwykłe approve zachowuje Fair Insert, manual drop ustawia jawną pozycję, Fair Sort jest osobnym działaniem. Nie zmieniono `now`, reguł 2/2 ani matematyki rund.

Aktualne PG17 obejmuje realne wyścigi drop/drop, drop/approve, drop/move, drop/start, drop/fair, denial/scope/2/2 i rollback audytu; dodatkowo wyścigi Fair Queue, linking/merge i Presence. Pełny browser wynik i ograniczenia podano w tabeli. Testy komponentowe nie zastępują gestów browser ani fizycznego touch.

## Unicode: migracje, backfill i granica aktywacji

Repo default jest nadal `legacy`. Lokalne jawne `unicode-v2` wymaga Unicode 17.0. Żadna flaga zdalna nie została odczytana ani przełączona. [Runbook 0031](../runbooks/unicode-song-search-rollout.md) obowiązuje jako techniczna procedura; historyczne wzmianki o Preview są zastąpione decyzją o produkcji bez Preview.

| Migracja | Zakres | Kompatybilność / weryfikacja |
| --- | --- | --- |
| 0028 | Prywatny kanał invalidacji event participants, helper/polityka Realtime i trigger | Zweryfikować wcześniejsze private/auth/realtime obiekty i membership; minimalny payload bez PII |
| 0029 | Participant connections/Presence, FK/indeksy/RLS, invalidacja zmian credentials | Weryfikować role, TTL i istniejące constraints; nie grantować tabel przeglądarce |
| 0030 | Device links, merge proposals, nullable merged_into_id/merged_at, scope constraints/triggery | Obecny kod listy uczestników wymaga tych kolumn niezależnie od search flagi |
| 0031 | Dwie prywatne tabele projekcji/aliasów, indeksy, pinned Unicode funkcje i triggery | Bez zmiany source songs/IDs/legacy keys; bez eager backfillu |

Należy porównać **wszystkie** istniejące journal hashes, nie tylko zakładać zakres czterech migracji. Zależności muszą być stosowane w kolejności; nie oznaczać ich jako wykonane ręcznie i nie używać `drizzle-kit push`. Drizzle migracja addytywna nie oznacza braku kosztu blokad, WAL, indeksów lub triggerów.

Backfill wybiera brakujące dokumenty v2, po 250 (maks. 1000), z source locks/SKIP LOCKED i krótkimi transakcjami. Jest wznawialny; missing count po zakończeniu musi wynosić zero, także po zwolnieniu cudzych blokad. Źródło i legacy keys są zachowane, a przyszłe importy/upserty utrzymują projekcję w tej samej transakcji przez trigger.

**Missing=0 nie wystarcza.** Walidacja musi porównać normalized title/artist, pełny search_text, short_grams, normalization_version i klucze/gramy aliasów z aktualnym źródłem oraz sprawdzić stan triggerów. SQL do porównania istnieje w runbooku. Obecny backfill naprawia brakujące rekordy, ale nie aktualizuje istniejących stale/corrupt documents. Jeśli mismatch>0, cutover jest zablokowany; potrzebna jest osobno zatwierdzona rekonsyliacja, bez nadpisywania source songs.

Rollback odczytów do legacy zachowuje uczestników, requesty, źródło, aliasy i tabele. Kursory wyszukiwania restartują od pierwszej strony. Nie usuwa kosztu triggerów. Nie wyłączać ich automatycznie: po pominiętych aktualizacjach wymagana jest pełna rekonsyliacja, nie missing-only backfill. Wymagana preflight długości rzeczywistych kluczy B-tree i kosztu importów.

P1 pozostaje ograniczone do jawnych aliasów z provenance, bez guessed universal transliteration. P2: brak rzeczywistego snapshotu KaraFun, brak uzgodnionego produkcyjnego latency budget i reprezentatywnego obciążenia. Test 100k jest syntetyczny; wykonywał się równolegle z innymi lokalnymi testami, więc nowe czasy nie stanowią spokojnego benchmarku porównawczego ani SLA.

Uwaga o artefaktach: istniejący test PG17 odświeżył stały `unicode-search-postgres-result.json`, nadpisując wcześniejszy surowy JSON. Jego poprzedniego pełnego pliku nie odtworzono; historyczne logi, hash oraz opisane pomiary poprzedniego raportu pozostały. Nowy wynik skopiowano jako `readiness-search-unicode-postgres-result.json` i jest dowodem wyłącznie tego nowego przebiegu. Nie przypisuje się mu daty starego runu.

## Produkcja: ponowna identyfikacja celu — korekta właściciela

Korekta z 2026-10-16: produkcję może obsługiwać projekt Supabase o nazwie `poza-nuta-development`. Nazwa `poza-nuta-production` nie dowodzi, że jest on używany. **Żadnego z tych powiązań nie potwierdzono aktualnym odczytem Vercel Production.** Nie łączono się z nieaktywnym projektem, nie wybudzano go i nie wykonywano w nim żadnych operacji.

| Sprawdzenie | Faktyczny wynik bieżącego odczytu |
| --- | --- |
| Lokalny projekt Vercel | `.vercel/project.json`: `projectName=pozanuta`; plik lokalnego powiązania, nie konfiguracja aktywnego deploymentu |
| Produkcyjny `DATABASE_URL` — tylko project ref | **NIEZWERYFIKOWANE**: brak autoryzacji do odczytu Production env |
| Produkcyjny `NEXT_PUBLIC_SUPABASE_URL` — tylko project ref | **NIEZWERYFIKOWANE** z tego samego powodu |
| Zgodność obu refów / aktywny deployment i alias | **NIEZWERYFIKOWANE**; nie wywnioskowano z lokalnego `.env`, nazwy ani ustawień MCP |
| Vercel MCP | Odczyt metadanych zakończony błędem `Auth required` podczas inicjalizacji; nie dotarł do konfiguracji projektu |
| Dozwolony `supabase-dev` MCP | Inicjalizacja odrzucona: brak zmiennej `SUPABASE_ACCESS_TOKEN`; nie wykonano SQL ani wywołania do bazy |
| Skonfigurowany ref `supabase-dev` | `qwmimnhdnzqfckswxjww`; to kierunek konfiguracji narzędzia, **nie dowód powiązania z aktualną produkcją** |
| Backup / PITR / zakończone odtworzenie właściwej bazy | **NIEZWERYFIKOWANE**; nie ma dostępnego bieżącego dowodu, nie jest to stwierdzenie braku kopii |

Nie zmieniano MCP, ustawień Work, sekretów ani env. W standardowych konfiguracjach CLI Vercel nie znaleziono uwierzytelnienia; zmienne tokenów Vercel/Supabase nie są dostępne w procesie. Supabase CLI jest obecnie dostępne, ale jego obecność nie daje autoryzowanego odczytu i nie zastępuje wymaganego scoped MCP. Wyszukano dostępne integracje Vercel/Supabase; nie instalowano ani nie podłączano nowych. Lokalna prywatna konfiguracja pozostała nienaruszona.

### Historia migracji — granica dowodu

Jedyny zachowany odczyt to `.artifacts/dnd-runtime-schema-readonly.json` z 2026-10-16 13:12:03 Europe/Warsaw: ref `qwmimnhdnzqfckswxjww`, PostgreSQL 17.6 (170006), `read_only=on`, 28 rozpoznanych migracji 0000–0027. Artefakt raportuje zgodne hashe, ale nie zawiera surowych hashy journalu pozwalających niezależnie powtórzyć to porównanie. Nie nazywamy go świeżym odczytem właściwej produkcji. Nie odczytano teraz historii Drizzle z żadnego zdalnego projektu.

Bieżący lokalny journal ma 32 wpisy 0000–0031. Względem historycznej listy brakuje 0028–0031; **to warunkowe porównanie artefaktu, nie lista migracji zatwierdzonych do produkcji**. Odczyt historyczny powstał przed 0031. Dopiero zgodność refów aktywnego Vercel Production i aktualny journal właściwej bazy pozwolą ustalić rzeczywiste pending migrations.

### Rzeczywiste bramki wydania

| ID | Bieżący blocker / warunek zamknięcia |
| --- | --- |
| PROD-01 | Brak autoryzowanego odczytu faktycznego celu. Ustalić aktywny deployment `pozanuta`, zredagowane refy obu zmiennych i ich zgodność, następnie właściwy projekt Supabase, PG i pełny journal Drizzle z hashami. Nie migrować przy niezgodności refów lub nieznanym celu. |
| PROD-02 | Brak dowodu wykonalnego odtworzenia właściwej bazy i kompatybilnego rollbacku kodu. Potwierdzić istniejącą kopię/PITR: identyfikator, czas, retencję, dostępność, zakres, RPO/RTO i dowód restore; wskazać poprzedni deployment działający z rozszerzonym schematem. Nie uruchamiać restore na produkcji dla samego testu. |
| PROD-03 | Rzeczywisty stan wymaganych migracji i uprawnień nieznany. Po PROD-01 zatwierdzić wyłącznie faktycznie zaległe migracje, ich wykonawcę i okno; merged_into_id z 0030 jest wymagane przez obecny kod niezależnie od silnika wyszukiwania. Nie używać runnerów lokalnych ani obchodzić ich guards. |
| PROD-04 | Przed testami online zatwierdzić zakres pojedynczego prywatnego wydarzenia, kont i sesji, bez wpływu na realne kolejki oraz globalny join; wskazać osobę obserwującą istniejące logi i warunki przerwania. Brak potwierdzonej izolacji lub rollbacku oznacza BLOCKED. |

Auth redirects, prywatny Realtime, pooler, obecna reguła ochrony publicznych kodów i logi to sprawdzenia istniejącej konfiguracji w PROD-01/04. Nie stwierdzono ich błędnej konfiguracji i nie nakazuje się budowy nowych systemów monitoringu, WAF czy osobnego środowiska. Brak dostępu blokuje ich ocenę; nie stanowi dowodu awarii. EN dashboardu, P1/P2 i dodatkowe benchmarki nie są blockerami wdrożenia kodu z `legacy` w zaakceptowanym zakresie. Fizyczny tablet pozostaje ręczną, niewykonaną kontrolą, a nie zgłoszonym błędem.

## Najkrótsza bezpieczna ścieżka bez Preview

1. Uzyskać istniejący autoryzowany dostęp odczytowy i zamknąć PROD-01/02 na **aktywnym** projekcie, niezależnie od jego nazwy. Potwierdzić refy obu zmiennych w aktywnym deploymentcie oraz w konfiguracji następnego Production builda; nie eksportować sekretów do raportu ani lokalnego env.
2. Po akceptacji jednego spójnego checkpointu i osobnych zgodach na commit/push przygotować dokładny artefakt wydania. Korzystać z ukończonej lokalnej macierzy, jeśli kod pozostaje zgodny z manifestem; nie powtarzać kosztownych benchmarków dla zmiany dokumentacji. Dashboard oceniamy w PL.
3. Po osobnej zgodzie zastosować przez normalną historię Drizzle **tylko faktycznie pending** migracje w wymaganej kolejności. Sprawdzić brak rozbieżności hashy i kompatybilność poprzedniego kodu. Nie dodawać ani nie odtwarzać obiektów w nieaktywnym projekcie. Przy pierwszym błędzie zatrzymać zmianę, nie przesuwać journalu ręcznie.
4. Po osobnej zgodzie wdrożyć na Vercel Production z `SONG_SEARCH_ENGINE=legacy`. Obecny kod wymaga schematu do 0030. Jeśli w tym oknie zatwierdzono też 0031, pamiętać, że jej triggery działają przy zapisach już przed włączeniem v2. **Backfill i pełna akceptacja Unicode nie muszą poprzedzać wdrożenia pozostającego na legacy.** Nie obiecywać wtedy aktywnej wyszukiwarki Unicode w produkcji.
5. Wykonać odczytowy smoke, następnie wyłącznie osobno zatwierdzone próby w prywatnym wydarzeniu z PROD-04. Bez lokalnych seed/reset/cleanup, masowych importów ani modyfikowania prawdziwych uczestników. Obserwować istniejące logi, błędy DB i kolejki; przy naruszeniu scope, 2/2 lub trwałej awarii przerwać próby i użyć wcześniej sprawdzonego kompatybilnego artefaktu.
6. **Oddzielne późniejsze uruchomienie `unicode-v2`**, bez nowego modułu: potwierdzona 0031, zatwierdzony bounded backfill, missing=0 i mismatch=0, aktywne triggery, Unicode 17 runtime, walidacja rzeczywistego katalogu i akceptowalnego kosztu zapytań. Dopiero osobna zgoda na flagę. Rollback odczytów to legacy, z zachowaniem źródeł i addytywnych obiektów; nie odwraca wykonanych zapisów ani kosztu triggerów.

**Bieżący werdykt: NO-GO z powodu niezweryfikowanego celu, schematu i odtwarzania, nie z powodu nazwy `development`.** Dostęp odczytowy zamyka lukę dowodową; sam nie jest zgodą na migrację, zmianę konfiguracji ani deployment. Nie ma Preview ani automatycznej promocji.

## Wydarzenie testowe w produkcji: warunki izolacji

Kandydat: oddzielny zatwierdzony workspace i prywatne, nieopublikowane wydarzenie z własną sesją/QR i syntetycznymi kontami. Bieżący kod discovery wymaga public visibility/publishedAt/slug; session capabilities są niezależne od publikacji. Lokalne scope/denial testy wspierają ten projekt, lecz nie certyfikują obecnego zdalnego schematu lub wszystkich globalnych efektów.

Wymagane przed zapisami: allowlist dokładnych event/session/workspace i request IDs, brak odwołań do prawdziwych osób, mały limit prób, operator z odpowiednimi prawami, monitoring i abort. Wejście przez jawny `/session/[code]` nowego wydarzenia; ogólne `/join` może prowadzić do realnej imprezy, więc nie jest bezwarunkowo bezpieczną ścieżką. Nie rotować globalnego kodu, nie zamykać aktualnego eventu, nie seedować wspólnego katalogu, nie uruchamiać importów i nie wykonywać cleanup/Delete realnych danych. Zakończenie wyłącznie testowego eventu wymaga odrębnie określonego zamiaru; dane/audyt zachować.

AGENTS opisuje single-active invariant, podczas gdy zatwierdzona przed checkpointem migracja 0022 usunęła odpowiedni indeks. Nie zmieniano tej domeny w bieżącym zadaniu. Produkcyjny preflight musi ustalić rzeczywisty kontrakt; nie dodawać indeksu ani przestawiać realnych wydarzeń według nieaktualnej instrukcji. Jeśli prywatnej sesji nie da się uruchomić bez ingerencji w realny event, PROD-04 pozostaje BLOCKED.

## Monitoring i rollback: dostępne mechanizmy, brakujące dowody

Kod ma `src/server/db-telemetry.ts` i runtime diagnostics: request/runtime/route, czas transakcji/operacji, commit/rollback i klasy błędów, opcjonalny poprawny commit/region Vercel; safe public errors i audit istotnych mutacji. Są lokalne testy patched Postgres.js recovery i timeoutów. Nie potwierdzono, że produkcyjne logi są dostępne operatorowi, mają wymaganą retencję/alerty ani że istnieje aktualny baseline.

`src/server/session-api/rate-limit-core.ts` ma procesowe limity defense-in-depth i jawnie zakłada produkcyjną regułę Vercel WAF dla publicznego rozwiązywania kodów. Lokalny PASS nie dowodzi skutecznego limitu między instancjami serverless. Preflight musi potwierdzić rzeczywistą regułę i zakres tras, zamiast zakładać jej istnienie z komentarza. Domenowy limit 2/2 jest osobno egzekwowany transakcyjnie w DB.

Operator wdrożenia musi widzieć błędy aplikacji/DB, timeout/pool, query latency i obciążenie, importy, subscribe/reconnect oraz rzeczywiste queue/refetch w zatwierdzonym wydarzeniu testowym. Bez dumpowania payloadów, PII, tokenów i credentials. Progi muszą być ustalone na realnym baseline, nie na syntetycznych benchmarkach tego komputera. Oddzielić błąd konfiguracji/schema, regresję kodu i koszt projekcji: mają różne rollbacki.

Archiwa kodu checkpointu nie są backupem produkcyjnej bazy. Vercel rollback nie odwraca 0028–0031, participant merges ani zmienionych danych. Nie ma automatycznego usuwania tabel/triggerów i resetów; trwałe dane wymagają kompatybilnego kodu lub zatwierdzonego forward-fix. Restore backupu jest osobną operacją z ryzykiem utraty zapisów po czasie kopii, wymagającą RPO/RTO i zgody.

Referencje producentów odczytano 2026-10-16 wyłącznie jako dokumentację publiczną, nie dowód konfiguracji tego projektu: [Supabase backups](https://supabase.com/docs/guides/platform/backups), [Vercel Instant Rollback](https://vercel.com/docs/instant-rollback). Supabase zaznacza osobny zakres obiektów Storage i brak haseł custom roles w dziennych kopiach; w razie ich używania trzeba potwierdzić odtworzenie także tych zależności. Vercel przywraca wcześniejszy deployment i jego konfigurację, co wymaga kontroli również wersji sekretów/zmiennych i zewnętrznej bazy. Sprawdzono indeks changelogu Supabase; nie aktualizowano SDK ani konfiguracji usług. Próba odczytu markdown przez web tool zgłosiła nieobsługiwany content-type; pobrano tę publiczną stronę bez credentials lokalnym HTTP klientem.

## Ograniczenia funkcjonalne i ręczne sprawdzenia

P1 aliasy i P2 realny katalog/load są jawnymi ograniczeniami, nie uniwersalnym transliteratorem. Publiczne UK nie obejmuje dashboardu UK. Pełna administracja/import/export/team/account/Auth-email nie otrzymuje automatycznie PASS z testu operator queue; EN tych ekranów jest poza kryterium obecnego wydania. Istniejący kod nadal zawiera wybór EN dla management — nie zmieniano go w tym odczytowym zadaniu; zakres akceptacji PL nie oznacza technicznego wymuszenia PL dla wszystkich przeglądarek. Physical tablet, Safari/WebKit, VoiceOver/TalkBack i native IME nie zostały wykonane.

Krótka checklista fizycznego tabletu — **NOT EXECUTED**, wyłącznie na zatwierdzonej izolowanej sesji:

- PL/EN/UK: QR, join, cyrylica/RTL/IME, wybór języka po refresh i zachowanie draftu/identity.
- Drag przed/za różnej wysokości kartami, początek/koniec/pusta kolumna i porównanie indicatora z kolejnością po reloadzie.
- Scroll treści versus hold uchwytu, autoscroll obu krawędzi, orientacja i klawiatura ekranowa.
- Rejected: otwarcie/cancel, potem tylko własny testowy request confirm; Escape i focus return.
- Dwa operatory, Realtime/Fair Sort podczas gestu, stale refusal, błąd zapisu i canonical recovery.
- Czytnik ekranu, announcements i reduced motion; request/2/2, queue update bez ręcznego refresh.

## Checkpoint integracyjny — plan, nie wykonanie

Wspólne komponenty panelu i boarda wymagają jednocześnie DnD i i18n; search/Next/Vitest/DB narzędzia wymagają lokalnych guards. Nie robić sztucznego „i18n/search bez DnD” przez pomijanie całych plików. Plan obejmuje cały uzgodniony obraz źródła, zależności/lockfile/migrację i dokumentację, z jawnym zachowaniem wcześniejszych lokalnych narzędzi i benchmark harnessu. Stop infrastruktury nie był cofnięciem ich kodu.

Proponowany tytuł: `feat: checkpoint multilingual karaoke and queue integration`.

Opis commita: PL/EN/UK participant UI, operator UI z akceptacją wydania w PL i zachowanymi wcześniejszymi katalogami EN, atomic queue placement i konflikty Realtime, addytywna projekcja Unicode za domyślnym legacy, lokalne test guards i aktualna weryfikacja. Wymienić P1/P2, physical/admin coverage i niezaspokojone produkcyjne bramki. Nie sugerować wykonania migracji/deploymentu.

Przed przyszłym commitem: zatwierdzony zakres, prywatny backup, dokładna lista ścieżek, przegląd całego staged diff i `git diff --cached --check`; sprawdzenie zgodności staged obrazu z testowanym manifestem. Wykluczyć `.codex/config.toml`, wszystkie prawdziwe env, `.artifacts`, `.auth`, trace, screenshoty, cookies, build output, logi i archiwa. Bez `git add .` lub `-f`. W tym zadaniu niczego nie stage'owano.

Plan obejmuje 238 nieprywatnych ścieżek delty względem chronionego HEAD (pełna lista poniżej). Bieżący Git ma 177 tracked modifications i 62 untracked files, z czego jedna tracked modification to wykluczona prywatna `.codex/config.toml`; index jest pusty. Pozostałe pliki bazowe pochodzą z checkpointu, nie wymagają ponownego dodawania.

Heurystyczny skan nieprywatnych zmienionych plików nie znalazł PEM private keys, Supabase secret keys ani JWT. Znane credential-URL są placeholderami `.env.example`, jawnie synthetic test values albo składaniem losowych credentials owned harnessu; nie drukowano wartości. Nie jest to pełny audyt historii Git ani ignorowanych prywatnych trace. `git ls-files` dla env/artefaktów/logów/kopii nie wskazuje nowych przypadkowych danych do commita. `.gitattributes` i patch Postgres.js są niezmienione względem HEAD, a reguła whitespace pozostaje ograniczona do wymaganego patcha.

Trzy wcześniejsze archiwa foundation/Slice5 istnieją i ponownie zgadzają się SHA-256 z zachowanym rejestrem. Nie są backupem produkcyjnej bazy ani pełną kopią późniejszego i18n/search. Bieżąca delta źródłowa względem HEAD ma osobny backup: `C:/Users/michas/.codex/backups/kunestu-integration-20261016-2f0we7_p/integration-source.zip` (238 plików + manifest, CRC i SHA-256 weryfikowane przy zamknięciu). Backup wyklucza `.codex/config.toml`, prawdziwe env i ignorowane credentials/trace; nie zastępuje prywatnej kopii tych plików właściciela. Rejestr sum archiwum jest w tym samym prywatnym katalogu. Archiwum oraz `.artifacts/readiness-checkpoint-candidate.json` odnoszą się do obrazu sprzed niniejszej korekty dokumentacji; nie nadpisywano ich i nie przypisuje się im nowego hasha raportu. Odrębny rejestr ponownego odczytu porównuje cały ten obraz i wykazuje wyłącznie zmianę niniejszego raportu.

## Narzędzia i stan końcowy

Lokalne Git/PowerShell/Node 24.19.0/pnpm 11.7.0/Python, Next 16.3.0, TypeScript, ESLint, Vitest, Playwright/Chromium, Docker i Supabase CLI obsługujące wyłącznie owned local fixtures. Publiczne odczyty dokumentacji Supabase/Vercel przez web/HTTP oraz jedna inwentaryzacja CUA zakończona informacją o wyłączonym dostępie do przeglądarki. W ponownym odczycie wywołano inicjalizację skonfigurowanych Vercel i supabase-dev MCP; obie zakończyły się wskazanymi błędami autoryzacji przed odczytem danych. Użyto też wyszukiwarki integracji Plugin Management. Brak produkcyjnych SQL/API danych, Vercel changes, commit/push/deploy. Nie zmieniano ustawień Work ani MCP.

HEAD i branch pozostają bez zmian, index pusty, prywatna konfiguracja ma zgodny hash. Końcowy manifest testowanego źródła i planowanego commita jest w `.artifacts/readiness-checkpoint-candidate.json`; to lokalny dowód, nie plik do dodania do commita. Po źródłowych zmianach wymagane jest porównanie hashy i odpowiednia ponowna weryfikacja. Ograniczone następne działania to zamknięcie aktualnych czterech bramek PROD-01–04; EN dashboardu nie jest wymaganą bramką wydania. Native-device i szerszy admin pozostają jawnymi granicami pokrycia. Nie zaplanowano nowego modułu ani przebudowy DnD lub infrastruktury.

### Dokładny proponowany zestaw 238 plików

Poniżej cała delta do jednego przyszłego checkpointu, wyłącznie po zatwierdzeniu. Lista nie jest stagingiem; prywatna `.codex/config.toml` i wszystkie ignorowane artefakty są wykluczone.

| Git | Ścieżka |
| --- | --- |
| ` M` | `.env.example` |
| ` M` | `.gitignore` |
| ` M` | `drizzle.config.ts` |
| ` M` | `drizzle/meta/_journal.json` |
| ` M` | `next.config.ts` |
| ` M` | `package.json` |
| ` M` | `playwright.local-supabase.config.ts` |
| ` M` | `pnpm-lock.yaml` |
| ` M` | `pnpm-workspace.yaml` |
| ` M` | `src/app/(platform-admin)/admin/layout.tsx` |
| ` M` | `src/app/(public)/events/[slug]/error.tsx` |
| ` M` | `src/app/(public)/events/[slug]/loading.tsx` |
| ` M` | `src/app/(public)/events/[slug]/not-found.tsx` |
| ` M` | `src/app/(public)/events/[slug]/page.tsx` |
| ` M` | `src/app/(public)/events/page.tsx` |
| ` M` | `src/app/(public)/page.tsx` |
| ` M` | `src/app/account/page.tsx` |
| ` M` | `src/app/account/security/page.tsx` |
| ` M` | `src/app/auth/invite/accept/page.tsx` |
| ` M` | `src/app/dashboard/new/page.tsx` |
| ` M` | `src/app/dashboard/onboarding/profile/page.tsx` |
| ` M` | `src/app/dashboard/org/[organizationId]/events/[eventId]/page.tsx` |
| ` M` | `src/app/dashboard/org/[organizationId]/events/[eventId]/participants/loading.tsx` |
| ` M` | `src/app/dashboard/org/[organizationId]/events/[eventId]/participants/page.tsx` |
| ` M` | `src/app/dashboard/org/[organizationId]/events/[eventId]/queue/page.tsx` |
| ` M` | `src/app/dashboard/org/[organizationId]/events/[eventId]/settings/page.tsx` |
| ` M` | `src/app/dashboard/org/[organizationId]/events/[eventId]/share/page.tsx` |
| ` M` | `src/app/dashboard/org/[organizationId]/events/new/page.tsx` |
| ` M` | `src/app/dashboard/org/[organizationId]/events/page.tsx` |
| ` M` | `src/app/dashboard/org/[organizationId]/page.tsx` |
| ` M` | `src/app/dashboard/org/[organizationId]/settings/page.tsx` |
| ` M` | `src/app/dashboard/org/[organizationId]/team/page.tsx` |
| ` M` | `src/app/dashboard/organizations/page.tsx` |
| ` M` | `src/app/dashboard/page.tsx` |
| ` M` | `src/app/dashboard/queue/page.tsx` |
| ` M` | `src/app/join/page.tsx` |
| ` M` | `src/app/layout.tsx` |
| ` M` | `src/app/s/[token]/layout.tsx` |
| ` M` | `src/app/setup/page.tsx` |
| ` M` | `src/app/sign-in/page.tsx` |
| ` M` | `src/app/sign-up/page.tsx` |
| ` M` | `src/components/app-shell/app-shell.tsx` |
| ` M` | `src/components/app-shell/app-sidebar-user.tsx` |
| ` M` | `src/components/app-shell/app-sidebar.tsx` |
| ` M` | `src/components/app-shell/sidebar-navigation.tsx` |
| ` M` | `src/components/app-shell/site-header.tsx` |
| ` M` | `src/components/operator/archive-organization-form.tsx` |
| ` M` | `src/components/operator/close-event-confirmation.tsx` |
| ` M` | `src/components/operator/create-event-form.tsx` |
| ` M` | `src/components/operator/dashboard-organization-switcher.tsx` |
| ` M` | `src/components/operator/dashboard-runtime-error.tsx` |
| ` M` | `src/components/operator/dashboard-shell.tsx` |
| ` M` | `src/components/operator/dashboard-skeletons.tsx` |
| ` M` | `src/components/operator/event-management-panel.tsx` |
| ` M` | `src/components/operator/event-overview.tsx` |
| ` M` | `src/components/operator/event-participants-panel.tsx` |
| ` M` | `src/components/operator/event-queue-api.ts` |
| ` M` | `src/components/operator/event-queue-panel.tsx` |
| ` M` | `src/components/operator/event-session-access-panel.tsx` |
| ` M` | `src/components/operator/event-workspace-header.tsx` |
| ` M` | `src/components/operator/fair-queue-control.tsx` |
| ` M` | `src/components/operator/general-join-access-panel.tsx` |
| ` M` | `src/components/operator/login-form.tsx` |
| ` M` | `src/components/operator/operator-profile-onboarding-form.tsx` |
| ` M` | `src/components/operator/organization-overview-view.tsx` |
| ` M` | `src/components/operator/organizer-sidebar.tsx` |
| ` M` | `src/components/operator/participant-merge-panel.tsx` |
| ` M` | `src/components/operator/setup-forms.tsx` |
| ` M` | `src/components/operator/signup-form.tsx` |
| ` M` | `src/components/operator/unauthorized-sign-in.tsx` |
| ` M` | `src/components/participant-merge-preview.tsx` |
| ` M` | `src/components/platform-admin/admin-access-denied.tsx` |
| ` M` | `src/components/platform-admin/admin-error-state.tsx` |
| ` M` | `src/components/platform-admin/admin-imports-panel.tsx` |
| ` M` | `src/components/platform-admin/admin-imports-skeleton.tsx` |
| ` M` | `src/components/platform-admin/admin-overview-skeleton.tsx` |
| ` M` | `src/components/platform-admin/admin-overview.tsx` |
| ` M` | `src/components/platform-admin/admin-shell.tsx` |
| ` M` | `src/components/platform-admin/admin-sidebar.tsx` |
| ` M` | `src/components/public/catalog-song-list.tsx` |
| ` M` | `src/components/public/current-queue-song-bar.tsx` |
| ` M` | `src/components/public/discovery-home-page.tsx` |
| ` M` | `src/components/public/event-card.tsx` |
| ` M` | `src/components/public/event-carousel.tsx` |
| ` M` | `src/components/public/event-search-form.tsx` |
| ` M` | `src/components/public/join-code-gate.tsx` |
| ` M` | `src/components/public/participant-identity-dialog.tsx` |
| ` M` | `src/components/public/participant-join-gate.tsx` |
| ` M` | `src/components/public/participant-profile-drawer.tsx` |
| ` M` | `src/components/public/public-request-page.tsx` |
| ` M` | `src/components/public/public-session-entry-shell.tsx` |
| ` M` | `src/components/public/public-session-lifecycle.tsx` |
| ` M` | `src/components/public/public-site-header.tsx` |
| ` M` | `src/components/public/session-catalog-collections.tsx` |
| ` M` | `src/components/public/session-catalog-genres.tsx` |
| ` M` | `src/components/public/session-code-form.tsx` |
| ` M` | `src/components/public/session-discovery-home.tsx` |
| ` M` | `src/components/public/session-participant-requests.tsx` |
| ` M` | `src/components/public/session-queue-list.tsx` |
| ` M` | `src/components/public/session-queue-panel.tsx` |
| ` M` | `src/components/public/session-request-page.tsx` |
| ` M` | `src/components/public/session-search-results.tsx` |
| ` M` | `src/components/public/session-shell-header.tsx` |
| ` M` | `src/components/public/session-song-artwork.tsx` |
| ` M` | `src/components/public/session-song-row.tsx` |
| ` M` | `src/components/public/session-state-alert.tsx` |
| ` M` | `src/components/public/song-details-drawer.tsx` |
| ` M` | `src/components/public/validation.ts` |
| ` M` | `src/components/request-status-badge.tsx` |
| ` M` | `src/components/theme-provider.tsx` |
| ` M` | `src/components/theme-switcher.tsx` |
| ` M` | `src/components/ui/breadcrumb.tsx` |
| ` M` | `src/components/ui/carousel.tsx` |
| ` M` | `src/components/ui/dialog.tsx` |
| ` M` | `src/components/ui/sheet.tsx` |
| ` M` | `src/components/ui/sidebar.tsx` |
| ` M` | `src/components/ui/sonner.tsx` |
| ` M` | `src/db/admin-database-url.ts` |
| ` M` | `src/db/backfill-song-public-id.ts` |
| ` M` | `src/db/check-db-state.ts` |
| ` M` | `src/db/import-ising.ts` |
| ` M` | `src/db/import-karafun-csv.ts` |
| ` M` | `src/db/ising-mapping.ts` |
| ` M` | `src/db/karafun-mapping.ts` |
| ` M` | `src/db/link-operator-auth.ts` |
| ` M` | `src/db/link-workspace-member.ts` |
| ` M` | `src/db/schema.ts` |
| ` M` | `src/db/seed-catalog-collections.ts` |
| ` M` | `src/db/seed-operator.ts` |
| ` M` | `src/db/seed.ts` |
| ` M` | `src/lib/song-search-cursor.ts` |
| ` M` | `src/lib/song-search.ts` |
| ` M` | `src/lib/supabase/admin.ts` |
| ` M` | `src/proxy.ts` |
| ` M` | `src/server/database-connection-config.ts` |
| ` M` | `src/server/operator-api/event-queue-validation.ts` |
| ` M` | `src/server/operator-api/event-queue.ts` |
| ` M` | `src/server/platform-admin/import-worker-process.ts` |
| ` M` | `src/server/public-api/validation.ts` |
| ` M` | `src/server/session-api/identity-http.ts` |
| ` M` | `src/server/session-api/service.ts` |
| ` M` | `src/server/song-search.ts` |
| ` M` | `tests/dashboardOrganizationRouting.test.ts` |
| ` M` | `tests/databaseConnectionConfig.test.ts` |
| ` M` | `tests/e2e/e2e-env.ts` |
| ` M` | `tests/e2e/local-supabase-fixture.ts` |
| ` M` | `tests/e2e/public-event-session-identity.local.spec.ts` |
| ` M` | `tests/e2e/run-local-supabase-smoke.ts` |
| ` M` | `tests/eventQueueManagement.test.ts` |
| ` M` | `tests/interactionFeedback.test.ts` |
| ` M` | `tests/participantLinkingMigration.test.ts` |
| ` M` | `tests/postgres/faultProcessHarness.ts` |
| ` M` | `tests/postgres/participantIdentity.integration.test.ts` |
| ` M` | `tests/postgres/postgresDriverFault.worker.mjs` |
| ` M` | `tests/postgres/postgresTestHarness.ts` |
| ` M` | `tests/postgres/songSearchAdversarial.review.test.ts` |
| ` M` | `tests/postgres/songSearchQuality.integration.test.ts` |
| ` M` | `tests/postgres/songSearchSqlApiUi.integration.test.tsx` |
| ` M` | `tests/publicClientValidation.test.ts` |
| ` M` | `tests/publicEvents.test.ts` |
| ` M` | `tests/vitest/admin-shell.component.test.tsx` |
| ` M` | `tests/vitest/admin-theme-switcher.component.test.tsx` |
| ` M` | `tests/vitest/app-shell-navigation.component.test.tsx` |
| ` M` | `tests/vitest/event-queue-panel.component.test.tsx` |
| ` M` | `tests/vitest/import-worker-runtime.test.ts` |
| ` M` | `tests/vitest/session-shell-header.component.test.tsx` |
| ` M` | `tests/vitest/setup.ts` |
| ` M` | `tests/vitest/song-search.test.ts` |
| ` M` | `tsconfig.json` |
| ` M` | `vitest.config.ts` |
| ` M` | `vitest.db-contention.config.ts` |
| ` M` | `vitest.db-timeouts.config.ts` |
| ` M` | `vitest.postgres.config.ts` |
| ` M` | `vitest.public-session-postgres.config.ts` |
| ` M` | `vitest.song-search-postgres.config.ts` |
| ` M` | `vitest.song-search-review.config.ts` |
| `??` | `docs/architecture/adr-queue-drag-and-drop.md` |
| `??` | `docs/architecture/adr-unicode-song-search.md` |
| `??` | `docs/features/enterprise-drag-and-drop.md` |
| `??` | `docs/features/internationalization-pl-en.md` |
| `??` | `docs/features/kunestu-production-readiness.md` |
| `??` | `docs/features/local-development-isolation.md` |
| `??` | `docs/features/post-i18n-unicode-integration-audit.md` |
| `??` | `docs/features/universal-multilingual-song-search.md` |
| `??` | `docs/runbooks/unicode-song-search-rollout.md` |
| `??` | `drizzle/0031_unicode_song_search.sql` |
| `??` | `drizzle/meta/0031_snapshot.json` |
| `??` | `playwright.queue-performance.config.ts` |
| `??` | `scripts/backfill-unicode-song-search.ts` |
| `??` | `scripts/generate-unicode-search-sql.ts` |
| `??` | `scripts/isolated-environment.ts` |
| `??` | `scripts/local-development.ts` |
| `??` | `scripts/local-environment-files.ts` |
| `??` | `scripts/local-next.ts` |
| `??` | `scripts/provision-local-worker.ts` |
| `??` | `scripts/seed-local-development.ts` |
| `??` | `scripts/test-target-bootstrap.ts` |
| `??` | `scripts/verify-local-development.ts` |
| `??` | `src/app/api/dashboard/organizations/[organizationId]/events/[eventId]/queue/requests/[requestId]/placement/route.ts` |
| `??` | `src/components/language-switcher.tsx` |
| `??` | `src/components/operator/queue-drag-board.tsx` |
| `??` | `src/db/song-search-backfill.ts` |
| `??` | `src/i18n/app-intl-provider.tsx` |
| `??` | `src/i18n/locale.ts` |
| `??` | `src/i18n/messages/en.json` |
| `??` | `src/i18n/messages/pl.json` |
| `??` | `src/i18n/messages/uk.json` |
| `??` | `src/i18n/request.ts` |
| `??` | `src/i18n/server.ts` |
| `??` | `src/i18n/source-index.json` |
| `??` | `src/i18n/text.ts` |
| `??` | `src/i18n/use-ui-text.ts` |
| `??` | `src/lib/UNICODE-LICENSE.txt` |
| `??` | `src/lib/local-target.ts` |
| `??` | `src/lib/queue-placement.ts` |
| `??` | `src/lib/song-search-engine.ts` |
| `??` | `src/lib/unicode-case-fold.json` |
| `??` | `src/server/song-search-unicode.ts` |
| `??` | `supabase/config.toml` |
| `??` | `tests/e2e/internationalization-locale.local-smoke.mjs` |
| `??` | `tests/e2e/internationalization.local-smoke.mjs` |
| `??` | `tests/e2e/queue-drag-performance.local.spec.ts` |
| `??` | `tests/e2e/theme-runtime.local.spec.ts` |
| `??` | `tests/e2e/unicode-song-search.local-smoke.mjs` |
| `??` | `tests/fixtures/unicode-song-search.ts` |
| `??` | `tests/localEnvironment.test.ts` |
| `??` | `tests/localEnvironmentFiles.test.ts` |
| `??` | `tests/localToolIsolation.test.ts` |
| `??` | `tests/postgres/unicodeSearchTimeout.integration.test.ts` |
| `??` | `tests/postgres/unicodeSongSearch.integration.test.ts` |
| `??` | `tests/queuePlacement.test.ts` |
| `??` | `tests/unicodeSongSearchMigration.test.ts` |
| `??` | `tests/vitest/internationalization-public-coverage.test.ts` |
| `??` | `tests/vitest/internationalization.component.test.tsx` |
| `??` | `tests/vitest/internationalization.test.ts` |
| `??` | `tests/vitest/queue-placement-routes.test.ts` |
| `??` | `vitest.song-search-unicode-quality.config.ts` |
| `??` | `vitest.unicode-search-postgres.config.ts` |
