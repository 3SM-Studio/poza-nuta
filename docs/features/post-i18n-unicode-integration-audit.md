# Audyt integracyjny po i18n, Unicode Search i Enterprise DnD

Data: 2026-10-16, Europe/Warsaw. Tryb: audyt lokalny, bez poprawek implementacji.

## Decyzja i zakres

**NO-GO dla osobnego checkpointu „tylko i18n + Unicode” przez dodanie całych obecnych plików.** Przetłumaczony panel zawiera już nowy DnD, a konfiguracja i testy zależą od pozostawionych lokalnych zabezpieczeń. Manifesty etapów opisują pochodzenie, nie są gotową listą do `git add`.

**Rekomendacja:** uzgodnić jeden jawnie integracyjny checkpoint zachowujący ukończony rdzeń DnD, i18n, Unicode oraz wymagane lokalne narzędzia. Nie przedstawiać go jako zakończenia audytu infrastruktury ani gotowości produkcyjnej. Przed zatwierdzeniem konkretnego commita sprawdzić jego dokładny obraz w odizolowanej kopii. Alternatywa wymagająca osobnej pracy to rekonstrukcja kolejnych spójnych snapshotów z zachowanych dowodów, bez cofania plików w bieżącym worktree.

**NO-GO dla wdrożenia teraz.** Zgodnie z najnowszą decyzją właściciela dalszy plan prowadzi bezpośrednio do produkcji, bez Vercel Preview. Ten audyt nie daje zgody na commit, push, migrację, backfill, zmianę flag ani deploy. Bramka zapisujących testów produkcyjnych pozostaje **BLOCKED do potwierdzenia izolacji wydarzenia i wykonalnego rollbacku**. Nie jest to stwierdzenie, że izolacja jest niemożliwa; nie została jeszcze wykazana dla rzeczywistej produkcji.

Przeczytano AGENTS.md, personal `codex-prompt-strategist` z czterema referencjami, `codex-repository-readiness-auditor` z referencjami metody/porównania/raportowania, projektowe zasady architektury, backendu, migracji, bezpieczeństwa i testów oraz referencje PostgreSQL dotyczące indeksów i krótkich transakcji. Udostępniona lista nie zawiera osobnego dedykowanego skilla Git; zastosowano ograniczenia Git z AGENTS i skilla audytu. Nie delegowano pracy agentom.

## 1. Rzeczywisty Git i zachowanie stanu

| Element | Wynik |
| --- | --- |
| Repo | `C:/Projects/pozanuta-stage-1` |
| HEAD / checkpoint | `721a1dd35caec0666d099024a344628c6e075c1c` |
| Gałąź | `feat/kunestu-participant-model-fair-queue` |
| Index | Pusty; zero staged files |
| Stan wejściowy audytu | 177 zmodyfikowanych tracked files + 60 untracked files = 237 ścieżek |
| Stan wyjściowy | Te same 237 ścieżek + niniejszy nowy raport = 238; bez usunięć i rename |
| `.codex/config.toml` | Prywatna zmiana użytkownika względem HEAD; niezmieniona względem manifestu startu Unicode i wejścia audytu; wykluczyć z każdego commita |
| `.gitattributes` / patch Postgres.js | Brak zmian względem HEAD; reguła whitespace/EOL ograniczona do `patches/postgres@3.4.9.patch` |
| Inne worktrees | Pięć wpisów w `git worktree list`; nie zmieniano pozostałych checkoutów |

SHA-256 prywatnej konfiguracji pozostaje `b3129521d573035ce05bc8ae85086fe3f3a25093fc26e69d9c72b440f4c4291b`. Nie odczytywano jej treści do raportu. Zmiana użytkownika względem checkpointu nie oznacza naruszenia konfiguracji przez audyt.

Porównanie 43 plików z `.artifacts/unicode-search-recovery-evidence.json` przed audytem: wszystkie bieżące sumy zgodne. Manifest startowy Unicode obejmuje 806 wcześniejszych plików: brak usunięć i zmian poza zadeklarowanym zakresem wyszukiwarki. Dotychczasowy `unicode-search-start.diff` był odświeżany w implementacji i nie jest dokładnym oryginalnym snapshotem; do granicy etapu służy manifest hashy.

Pełna lista bieżących ścieżek i ich pochodzenia znajduje się w aneksie. Zapisano także ignorowany maszynowy inwentarz audytu z hashami i wynikami kontroli; nie zawiera wartości zmiennych środowiskowych ani credentials.

## 2. i18n PL/EN/UK

| Obszar | Werdykt | Podstawa i granica |
| --- | --- | --- |
| Publiczna sesja PL | PASS w udokumentowanym środowisku lokalnym | Historyczne P0 browser; świeże testy komponentowe/negocjacji/pokrycia |
| Publiczna sesja EN | PASS w udokumentowanym środowisku lokalnym | Fallback EN, własna preferencja, 2/2, błędy, sesja i Realtime w historycznym smoke |
| Publiczna sesja UK | PASS w udokumentowanym środowisku lokalnym | Publiczny katalog, cyrylica, liczniki, linking/merge UI, desktop i emulowane mobile |
| Dashboard PL/EN | PARTIAL | Implementacja i katalogi oraz read-only smoke organizacji/kolejki/uczestników; brak pełnych podróży administracyjnych i mutacji w obu językach |
| Całe pierwotne zadanie i18n | PARTIAL | Nie należy rozszerzać publicznego PASS na nieprzetestowaną administrację/urządzenia |

Zweryfikowane źródła: `src/i18n/locale.ts`, `request.ts`, `app-intl-provider.tsx`, `text.ts`, `server.ts`, `use-ui-text.ts`, `src/components/language-switcher.tsx`, RootLayout, proxy, katalogi i testy. next-intl jest przypięty do 4.14.9. Katalogi `ui`: PL 1155, EN 1155, UK 371. UK jest katalogiem publicznym, nie deklaracją tłumaczenia dashboardu.

Publiczny priorytet: poprawne `kunestu_locale`, następnie obsługiwany język Accept-Language według wag i stabilnej kolejności, następnie EN. Management ma osobny fallback PL; preferencja UK daje tam EN bez nadpisania cookie. Przełącznik publiczny pokazuje Polski/English/Українська, management tylko PL/EN. Cookie ma Path=/, roczny czas, SameSite=Lax i Secure na HTTPS. Nie przechowuje sesji ani tożsamości.

Zmiana przez `router.refresh()` nie zmienia URL i nie zeruje celowo formularzy. Root provider rozstrzyga zakres także podczas nawigacji klienta. Nie dodano segmentów językowych, nie przepisano QR/tokenów/danych domenowych. Daty są lokalizowane przy zachowaniu Europe/Warsaw. Nie ma tłumaczenia nazw utworów czy uczestników. Źródłowy adapter nieznanych tekstów może zwrócić oryginał; nowe UI wymaga wpisów i testów, sam brak surowych JSX literals nie dowodzi kompletności.

Historyczne dowody z 2026-10-16:

- `i18n-three-final-test.log`: 413 Node + 673 Vitest; mtime 13:34:55 UTC; typecheck/lint/build zakończone do 13:36:11 UTC.
- `i18n-p0-browser-result.json`: 22 scenariusze; trzy niezależne PL/EN/UK, własne preferencje, requesty, 2/2, duplikat, Presence, Realtime i anulowanie wyłącznie własnego syntetycznego requestu. Pięć oczekiwanych odpowiedzi 409/500; zero runtime errors i zewnętrznych requestów.
- `i18n-en-fallback-browser-result.json`: 12 kontroli języka/persistencji, w tym wszystkie wymagane przykłady fallbacku, bez mutacji.
- `i18n-public-negative-result.json`: cztery negatywne/touch scenariusze UK, zero join mutations; iPhone 13 jest emulowany.
- `i18n-management-current-result.json`: 12 kontroli, w tym PL/EN dashboard/kolejka/uczestnicy; read-only.

Pełne admin/import/export/team/account/security/Auth-email journeys w obu językach oraz fizyczne urządzenia i czytniki ekranu pozostają NOT VERIFIED. Dokument źródłowy: [internationalization-pl-en.md](internationalization-pl-en.md).

## 3. Universal Multilingual Song Search

| Obszar | Werdykt |
| --- | --- |
| P0 Unicode w oryginalnym piśmie, niezależne PL/EN/UK | PASS lokalnie z jawnym `unicode-v2` |
| P1 alternatywne zapisy/transliteracja | PARTIAL: sześć jawnych aliasów, bez uniwersalnej automatycznej transliteracji |
| P2 fuzzy PL/EN i wydajność | PARTIAL: zachowane testy jakości przechodzą; brak rzeczywistego katalogu, sparowanego benchmarku i docelowego budżetu opóźnień |

Przeczytano [raport implementacji](universal-multilingual-song-search.md), [runbook](../runbooks/unicode-song-search-rollout.md), ADR i implementacje normalizacji, walidacji, kursora, wyszukiwania, backfillu i generatora SQL. Endpointy publiczne, sesyjne i operatora używają wspólnej usługi; browse przełącza predykat. Autoryzacja i kontrakty domenowe pozostają na istniejących granicach.

### Migracja i dane

0031 jest addytywna: tworzy **dwie nowe tabele projekcji/aliasów**, ich kolumny, FK, indeksy B-tree/GIN, funkcje i triggery. Nie dodaje kolumn do istniejącego `songs`, nie nadpisuje jego tytułów, identyfikatorów ani legacy keys. RLS jest włączone bez polityk przeglądarkowych; anon/authenticated nie mają dostępu do tabel ani helperów. SECURITY DEFINER triggery mają stały search_path i kwalifikowane odwołania. Snapshot 0031 zachowuje wcześniejsze modele; journal ma wpis idx31. Pliki 0031 są lokalne, nadal untracked, zatem nie wolno mówić, że migracja jest już w commicie.

Historyczne lokalne przygotowanie: PG17.6 na dedykowanym loopback 55522, sprawdzonych 31 wcześniejszych migracji, zastosowana 0031, backfill 20 wcześniejszych syntetycznych utworów, 15 wielojęzycznych fixture i sześć aliasów, brakujących projekcji zero. Nie wykonywano teraz zapytań do żadnej bazy. Stan rzeczywistej produkcji i jej zaległości migracyjne pozostają NOT VERIFIED; wcześniejszy błąd `merged_into_id` uniemożliwia zakładanie, że jedyną zaległością jest 0031.

Backfill wybiera brakujące dokumenty v2 po id, blokuje source rows przez FOR UPDATE SKIP LOCKED i zatwierdza małe transakcje (domyślnie 250, maksymalnie 1000). Jest wznawialny/idempotentny dla brakujących rekordów. Pusty batch przy cudzych blokadach nie dowodzi ukończenia; końcowy missing count musi wynosić zero. Nie naprawia już istniejących nieaktualnych projekcji. Lokalny CLI waliduje owned loopback przed klientem DB i nie ma zdalnego override.

Importy iSing/KaraFun zachowują legacy keys, a trigger utrzymuje v2 w tej samej transakcji dla insert/update/upsert. Awaria projekcji może zablokować zapis/import, również gdy odczyty pozostają legacy: koszt triggerów nie znika po rollbacku flagi. Preflight rzeczywistych długości kluczy i kosztów importu jest wymagany.

Repozytoryjny default `SONG_SEARCH_ENGINE` to `legacy`; jawne `unicode-v2` wymaga Unicode 17.0 w runtime. Historyczny lokalny smoke uruchamiał je jawnie. Nie odczytywano zdalnej flagi ani nie zmieniano jej teraz. Rollback odczytów: legacy, restart wyszukiwania/kursora; pozostawić tabele i triggery. Wyłączenie triggerów wymaga osobnego planu naprawy istniejących stale rows, nie zwykłego missing-only backfillu.

### Dowody i ograniczenia

- Zachowane `unicode-search-final-test.log`: 414 Node + 679 Vitest, zero failures/skips, mtime 14:31:53 UTC. Build 14:34:18 UTC, typecheck 14:39:59 UTC; pełny lint zakończył się bez błędów. Dodatkowy lint dwóch testów był przez konfigurację pominięty i nie liczy się jako ich pokrycie.
- PG17.10: 13 452 przypadki zgodności JS/SQL, 61 oryginalnych zapytań, sześć aliasów, expand/resume/idempotencja, zachowanie źródła, upsert/rollback, uprawnienia, deterministyczna paginacja; osobny test timeout/recovery i ograniczonego importera. To zachowane wyniki, nie dzisiejsze ponowienie integracji.
- Browser: 18 zapytań w każdym PL/EN/UK = 54; identyczne ordered IDs, oryginalne nazwy, RTL, CJK, browse, operator, arabskie/japońskie zgłoszenia i 2/2. Dziewięć grup, zero runtime errors/external requests. UK to Chromium iPhone 13 emulation.
- 100 000 syntetycznych rekordów; mediana/p95 z siedmiu próbek: popularne `周` 83,48/92,24 ms, rzadkie `光` 7,93/10,18 ms, `fi` 51,19/53,15 ms, szerokie `Fixture Song 90000` 621,02/634,19 ms. Osiem ciężkich równoległych zapytań: 2715,82 ms całej paczki. Nie jest to SLA ani p95 produkcyjne.
- Przykłady EN kosztują około 23 ms wobec pojedynczej referencji legacy około 15 ms; nie ma dowodu statystycznego braku regresji szybkości. Złożenie i zapis 100k rekordów trwały 106,39 s. Brak source KaraFun i realnego rozkładu katalogu jest jawnym ograniczeniem.
- Parametry SQL są wiązane, wildcardy escapowane; istnieją limity długości/mark runs/tokenów/kandydatów/stron oraz 2 s timeout. Krótkie CJK używa gramów/literal recheck, pojedyncze cyfry w tokenach są zachowane. Nie deklaruje się pełnego pokrycia wszystkich języków, wariantów arabskich/hebrajskich ani naturalnej tokenizacji wszystkich pism.

## 4. Enterprise DnD: co rzeczywiście jest ukończone

Rdzeń został zaimplementowany i ma historyczny lokalny PASS. Nie jest jedynie rozpoczętym szkicem: wspólny slot BEFORE/AFTER, rzeczywiste wysokości kart, outside cancel, empty lane, mouse/touch/keyboard, optimistic canonical state, dialog rejected, atomic status+position, CAS po mutexie i unieważnianie gestu przy Realtime/Fair Sort są w kodzie. Fair Queue core nie został przebudowany. Backend placement/validation/identity reader/helper/API oraz testy PG17 zachowują hashe końcowego DnD ledgeru.

`.artifacts/dnd-final-source-ledger.json` obejmuje 18 plików. **12/18 pozostaje identycznych**, sześć zmieniło się później:

| Zmieniona ścieżka | Późniejsza zależność |
| --- | --- |
| `src/components/operator/event-queue-panel.tsx` | i18n tłumaczy istniejący nowy panel |
| `src/components/operator/queue-drag-board.tsx` | i18n tłumaczy board i announcements |
| `playwright.local-supabase.config.ts` | Lokalne guards/izolacja i theme smoke |
| `tests/e2e/local-supabase-fixture.ts` | Lokalne guards i izolacja fixture |
| `tests/e2e/public-event-session-identity.local.spec.ts` | Synchronizacja zapisu w scenariuszu merge po izolacji |
| `tests/e2e/run-local-supabase-smoke.ts` | Czyszczenie env, guards i tryb benchmarku |

Zachowane treści obu komponentów w `i18n-component-baseline.json` mają dokładne hashe oryginalnego DnD ledgeru. Można więc analizować ich późniejszy przyrost bez zgadywania i bez przywracania starej wersji do worktree.

Historyczne logi: 12/12 E2E, mtime 09:59:58 UTC; PG17 54/54, mtime 08:51:36 UTC; 405 Node + 601 Vitest i pięć bramek do 10:03:07 UTC. Dzisiejsze 155 testów zawiera komponenty panelu, route placement i integrację tłumaczeń, ale **nie odtwarza realnych gestów ani wyścigów DB na aktualnym połączonym stanie**.

Istnieją też późniejsze rzeczywiste wyniki benchmarku: `dnd-performance-raw.json`, `dnd-performance-summary.json`, `dnd-performance-run.log` (2/2, mtime 11:20:00 UTC; dziewięć gestów plus theme test). 20/50/100 zgłoszeń, po trzy próby, optimized build, Chromium 149 headless/SwiftShader, desktop 1500x1000, bez throttlingu. Indicator p95: 17,6/26,6/44,0 ms; klatki maksymalne 16,8/66,7/166,6 ms; przy 100 rekordach long tasks do 165 ms i zapis widoczny po około 404–438 ms. To historyczne pomiary tego hosta, nie aktualny po-i18n benchmark ani fizyczny tablet. Test używa dedykowanego fixture 55432/55431, runner nakłada migracje i usuwa własny disposable stack; nie został uruchomiony w audycie.

**Werdykt DnD: PASS historycznego rdzenia; PARTIAL dla końcowej integracji/przedwdrożeniowego zamknięcia.** Do ukończenia: aktualny pełny lokalny browser/PG17 rerun po scaleniu etapów, rozstrzygnięcie ograniczeń wydajności w raporcie, fizyczny touch i czytniki ekranu, przegląd kompatybilności produkcyjnej. Nie wykryto nowej potwierdzonej awarii produkcyjnej logiki DnD; brak nowych wyników nie jest nowym PASS. Nie rozszerzano DnD.

## 5. Zależności i ustalenia checkpointu

### INT-01: nie można rozdzielić etapów samymi ścieżkami

**VERIFIED, P1 dla poprawności przygotowania checkpointu.** `event-queue-panel.tsx` importuje nowy board i jego kontrakt; board importuje `@/i18n/*`. Staging panelu bez nowych plików DnD łamie zależności; staging całego panelu włącza DnD. To nie świadczy o defekcie aplikacji, lecz blokuje deklarację „commit nie zawiera DnD”.

`package.json` uruchamia `scripts/local-next.ts`, `next.config.ts` importuje local-target, Vitest configs importują local-environment-files, a backfill i harness używają local-target. Wybranie samych manifestów i18n/search bez tych plików nie odtwarza testowanego stanu. Nie usuwać guards, żeby uprościć staging.

Minimalne rozwiązanie: zaakceptować szerszy jawny zakres integracyjny albo przygotować odrębną, izolowaną rekonstrukcję kolejnych commitów i sprawdzić każdy obraz. Właściciel wybiera zakres przed przyszłym stagingiem. Blast radius: build, dev, testy, nowe API placement, narzędzia DB, bezpieczeństwo lokalnych targetów.

### INT-02: manifest i18n nie jest kompletną listą końcową

**VERIFIED, P2.** `i18n-changed-files.json` ma 131 ścieżek, ale pomija co najmniej sześć późniejszych plików należących do zakresu:

- `docs/features/internationalization-pl-en.md`
- `src/proxy.ts`
- `src/i18n/app-intl-provider.tsx`
- `src/i18n/messages/uk.json`
- `tests/e2e/internationalization-locale.local-smoke.mjs`
- `tests/vitest/internationalization-public-coverage.test.ts`

Nie zmieniano starego dowodu. Uzupełniono bieżący inwentarz audytu i jawnie oznaczono rozszerzenie. Weryfikacja kandydata musi uwzględnić wszystkie 137 ścieżek i18n oraz wspólne zależności. Raport etapu nie jest substytutem import graph.

### INT-03: instrukcja domenowa jest starsza od checkpointu

**VERIFIED, P2; blokuje przyjęcie niezweryfikowanych założeń testu produkcyjnego.** AGENTS.md wymaga single-public-active-event. Tymczasem już commit `be5cf10` obecny przed checkpointem zawiera `0022_multi_active_public_events.sql`, która usuwa per-workspace unique index; bieżący schema nie odtwarza tego ograniczenia. Nie zmieniano AGENTS ani domeny. Należy uzgodnić obowiązujący kontrakt z właścicielem i sprawdzić rzeczywisty schemat produkcji w osobnym audycie przedwdrożeniowym. Nie dodawać indeksu ani zamykać realnych wydarzeń na podstawie starej instrukcji.

### INT-04: granica historycznych E2E i przenośność locale

**RISK, P2.** Główne E2E DnD i benchmark używają polskich selektorów, bez jawnej preferencji języka w tworzonych kontekstach. Odczytowy test Chromium na about:blank wykazał na tym hostcie `navigator.language=pl`, zatem nie odtworzono awarii; zero żądań sieciowych. Na hoście EN testy zależą od innego wyniku negocjacji. Przed finalnym rerunem ustalić jawny język wszystkich kontekstów tych istniejących scenariuszy, zachowując osobne wielojęzyczne testy. Nie zmieniano testów podczas audytu.

### Co można przygotować do checkpointu

Rdzeń i18n/search ma 175 unikalnych ścieżek (137 + 43 minus pięć wspólnych). Dołączenie obecnej zależności DnD daje 191. To **kandydaci implementacyjni**, nie lista do automatycznego stagingu. Pozostałe 45 nieprywatnych plików obejmuje lokalne zabezpieczenia/narzędzia, ThemeProvider i harness benchmarku; ich zależności muszą zostać jawnie rozwiązane. Aneks rozdziela gotowy rdzeń od plików wymagających zamknięcia walidacji lub uzgodnienia zakresu.

Najprostszy kompletny obraz obecnego kodu to **236 nieprywatnych ścieżek + ten raport = 237 ścieżek przyszłego checkpointu integracyjnego**, ale obejmuje on świadomie zachowany WIP narzędzi/audytu infrastruktury i benchmarków. Nie rekomenduje się zatwierdzania go pod nazwą „ukończone i18n/search bez DnD”. Nie należy pomijać trzech plików benchmarku bez przeglądu hunka runnera, który odwołuje się do jego konfiguracji.

Proponowany przyszły tytuł, jeśli właściciel zaakceptuje pełny zakres: `chore: checkpoint multilingual queue integration`. Opis musi wymieniać i18n, Unicode default legacy, DnD oraz zachowane lokalne tooling/WIP i niespełnione bramki produkcyjne. Nie wykonano stagingu ani commita.

## 6. Artefakty, sekrety i kopie

`git ls-files` dla `.artifacts`, `.auth`, `test-results`, env i archiwów wykazał wyłącznie `.env.example`. Przykładowe connection strings są placeholderami. Heurystyczny skan bieżących 236 nieprywatnych plików nie znalazł PEM private keys, Supabase secret keys ani JWT. Trafienia credential-URL otwarto/zaklasyfikowano jako placeholdery, jawne synthetic test values lub składanie losowego URL disposable harnessu; nie publikowano wartości. To nie jest pełny audyt historii Git ani dowód braku każdego sekretu.

Ignorowane są `.artifacts/`, `.auth/`, `test-results/`, `.vercel/`, local env, build/cache i logi. Mogą zawierać credentials syntetyczne, cookies i trace; **nie są kandydatami do commita**, nawet jeśli są dowodem PASS. `.artifacts/foundation-close-audit.py` również pozostaje poza źródłami Git. Nie wykonywać `git add -f`, `git add .` ani masowego przenoszenia artefaktów do dokumentacji.

Trzy archiwa nadal istnieją i świeżo zgadzają się SHA-256 z historycznym `foundation-backup-verification.json`:

- `%LOCALAPPDATA%/Temp/pozanuta-slice5-baseline-jsffgk85/worktree.zip`
- `%LOCALAPPDATA%/Temp/pozanuta-foundation-checkpoint-ygsmi_r5/worktree-changes.zip`
- `C:/Users/michas/.codex/backups/pozanuta-foundation-20261016-9rr9827z/worktree-changes.zip`

Katalog odtworzeniowy `%LOCALAPPDATA%/Temp/pozanuta-foundation-restore-lq2rscde` istnieje; nowego restore nie wykonywano. Archiwa są starsze niż i18n/search i nie stanowią pełnej kopii aktualnych zmian. Przed przyszłym stagingiem potrzebny jest nowy prywatny backup obecnego źródła i oddzielne zachowanie ignorowanych dowodów; niczego teraz nie pakowano ani nie usuwano.

Kwarantanna `C:/Users/michas/.codex/private-backups/pozanuta-stage1-pre-isolation-20261016` nadal zawiera dawne `.env`, `.env.local` i manifest. Sprawdzono wyłącznie istnienie/metadata, bez odczytu lub przywracania sekretów. Obecne role-specific local env pozostają nietknięte. Nie przywracać produkcyjnych credentials do lokalnego checkoutu.

## 7. Weryfikacja tego audytu

| Kontrola | Wynik tego przebiegu |
| --- | --- |
| Node: queuePlacement + unicodeSongSearchMigration | PASS 15/15, bez DB |
| Vitest: trzy pliki internationalization, song-search, event-queue-panel, queue-placement-routes | PASS 155/155, sześć plików, mock/controlled boundaries |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS; istniejące wykluczenia tests/scripts pozostają |
| `git diff --check` | PASS; ponowione po zapisaniu raportu |
| Porównania manifestów, prywatnej konfiguracji, checkpointu, indexu, archiwów | PASS w opisanym zakresie |
| Chromium about:blank, odczyt navigator.language | `pl`, zero network requests; nie jest browser smoke aplikacji |
| Pełne `pnpm test`, nowy build | NOT RUN w audycie dokumentacyjnym; zachowane historyczne wyniki opisano z oryginalnymi datami |
| PG17 integracje, E2E aplikacyjne, benchmarki | NOT RUN; runner wykonuje migracje/seedy/zapisy, poza zakresem tego audytu |
| Produkcja, usługi zdalne, Vercel/MCP | NOT QUERIED / NOT MODIFIED |

Nowe logi: `.artifacts/post-i18n-integration-{node,vitest,typecheck,lint,diff-check}.log`; metadane porównań i ścieżek: `post-i18n-integration-inventory.json`; odczytowy test przeglądarki: `post-i18n-integration-browser-locale.json`. Historyczne logi nie otrzymały nowej daty i nie zostały przepisane.

Użyto tylko lokalnego Git/PowerShell/Node/pnpm, Vitest/TypeScript/ESLint i Chromium przez zainstalowany Playwright. Bez zdalnych MCP, GitHub, Vercel, Supabase API/SQL, migracji lub seedów. Jedyna nowa nieignorowana zmiana audytu to ten raport.

## 8. Zaktualizowany plan: produkcja bez Preview

Ta sekcja jest nadrzędną aktualizacją strategii względem historycznych wzmianek o Preview w poprzednich raportach i runbooku. Nie edytowano tych historycznych dokumentów, żeby nie przypisywać im nowej decyzji. **Nie tworzymy ani nie konfigurujemy Vercel Preview.**

### G1. Zamknięcie lokalnej integracji i DnD

Uzgodnić zakres checkpointu i rozbieżność instrukcji domenowej. Zachować backup całego bieżącego źródła bez credentials oraz osobno prywatne dowody. W izolowanej kopii przygotować dokładny kandydat bez zmian bieżącego worktree. Sprawdzić dependency closure, brak prywatnych env/config/logów i zgodność lockfile/patcha. Po osobnym zatwierdzeniu lokalnych zapisujących testów uruchomić pełne Node/Vitest/typecheck/lint/build/diff-check, PG17 Slice1–5/search/DnD/driver i browser na zoptymalizowanym buildzie. E2E wyłącznie disposable local target, bez używania produkcyjnych credentials. Uzupełnić końcowy DnD handoff i manualne testy fizycznego tabletu; nie dodawać funkcji ani optymalizacji bez wykrytego problemu.

### G2. Production-readiness audit i odtworzenie

Osobny zakres odczytowy na dokładnie zatwierdzonej produkcji: potwierdzić projekt, Vercel Production runtime/branch/config, rzeczywistą wersję PostgreSQL, UTF-8, pg_trgm, pooler/role/timeout, Auth redirects, Realtime grants i listę zastosowanych migracji z hashami. Nie wystarcza nazwa lokalnego MCP ani odczyt `.env`. Nie zakładać zastosowania 0028–0030 lub zgodności schematu z kodem; sprawdzić m.in. `merged_into_id` i istniejące dane/constraints.

Potwierdzić aktualny backup, retention/PITR jeśli dostępne, możliwy RPO/RTO, uprawnienia do przywrócenia i dowód próby odtworzenia. Nie deklarować restore na podstawie samej ikony backupu ani istniejących archiwów kodu. Nie kopiować teraz produkcyjnych danych/sekretów do lokalnego środowiska; ewentualna próba odtworzenia danych wymaga osobnego zatwierdzonego, prywatnego zakresu. Brak wykonalnego odtworzenia blokuje migracje. Przygotować dokładną kolejność zaległych migracji, kompatybilność starej i nowej aplikacji oraz niezależny rollback kodu i odczytów wyszukiwania.

### G3. Udowodnienie izolacji wydarzenia testowego

W obecnym kodzie sesyjne capabilities nie wymagają publicznej publikacji; discovery filtruje visibility=public oraz publishedAt/slug. Jest więc kandydat na **prywatne, nieopublikowane wydarzenie z własną sesją i syntetycznymi uczestnikami**, najlepiej w zatwierdzonym osobnym workspace. Nie jest to jeszcze potwierdzenie wszystkich transakcyjnych scope'ów ani konfiguracji produkcyjnej.

Najpierw udowodnić lokalnie/odczytowo: event/session/workspace mutex i każda mutacja są scoped, broadcast dotyczy własnego wydarzenia, brak wycieku do publicznego discovery, brak zmiany istniejącego globalnego join destination lub kodów realnego wydarzenia. Używać jawnych testowych `/session/[code]` i dashboard event IDs; `/join` może prowadzić do realnego wydarzenia i nie jest bezwarunkowo bezpiecznym wejściem testowym. Nie zamykać ani nie przełączać realnego eventu dla testu.

Syntetyczne zapisy mają mieć allowlist dokładnych IDs, osobne konta/preferencje, mały limit i plan zatrzymania; bez resetQueue/seed/migrate/cleanup istniejącego E2E runnera w produkcji. Nie używać importów, resetów lub kasowania katalogu jako testu wydarzenia. Po testach pozostawić audytowalne dane albo osobno zatwierdzić zamknięcie wyłącznie testowego wydarzenia; bez automatycznego delete. Prywatne wydarzenie izoluje domenowe requesty, **nie** globalny katalog, obciążenie DB ani globalną flagę wyszukiwarki. Jeśli izolacji lub bezpiecznego wycofania nie uda się wykazać, **BLOCKED**, bez zapisów produkcyjnych.

### G4. Kontrolowany deployment aplikacji

Po G1–G3 i osobnych zatwierdzeniach commita/pusha/deploymentu: zatwierdzony artefakt i quiet window z operatorem, wcześniejszy kompatybilny deployment gotowy do przywrócenia, monitoring i warunki abort. Zastosowanie zaległych migracji jest osobną zgodą, z backupem i weryfikacją każdej; żadnego automatycznego `drizzle-kit push`. Pierwszy etap aplikacji może pozostawić `legacy`, ale wymaga kompletnego schematu pozostałych używanych modułów. Minimalny read-only smoke, następnie tylko zatwierdzone scenariusze na izolowanym wydarzeniu testowym. Nie nazywać tego Preview lub bezpiecznym canary per-event: kod jest globalnie produkcyjny.

### G5. Osobne bramki Unicode v2

1. Jawnie zatwierdzony target i migracja 0031 po weryfikacji jej poprzedników; backup/restore, role, runtime Unicode17 i PG17, koszt triggerów i indeksów.
2. Odczyty nadal legacy. Osobno zatwierdzony zdalny runner backfillu z guardami; obecny lokalny CLI ma nadal odrzucać zdalny URL. Monitorować WAL/IO/importy i możliwość przerwania po batchu.
3. Missing=0, pełna zgodność źródła/projekcji/gramów/aliasów, zachowanie IDs/legacy keys, rzeczywista jakość PL/EN i wymaganych pism, wielkości kluczy, indeksy, load i ustalony latency budget. Brak rzeczywistego katalogu w obecnym benchmarku nie zamyka tej bramki.
4. Osobna zgoda na globalne `unicode-v2`, obserwacja błędów/p95/timeout/pool/importów i PL/EN/UK. Zmiana dotyczy wszystkich uczestników; testowe wydarzenie nie ogranicza jej blast radius.
5. Gotowy rollback flagi do legacy i aplikacji do kompatybilnego artefaktu; pozostawić addytywne tabele i aktywne triggery. Przy problemie triggerów wymagany odrębny forward-fix/reconciliation. Nie odwracać migracji przez usuwanie źródła lub pozorowanie journalu.

## 9. Kolejność i punkt zatrzymania

1. Właściciel zatwierdza zakres przyszłego integracyjnego checkpointu albo osobną rekonstrukcję commitów. Niniejszy raport nie wykonuje żadnej z tych opcji.
2. Następny ograniczony etap: zamknięcie lokalnej integracji/DnD i weryfikacja dokładnego kandydata. Nie wracać do szerokiej przebudowy infrastruktury ani nie usuwać jej zabezpieczeń.
3. Osobny production-readiness audit oraz dowód izolacji wydarzenia/rollbacku; brak Preview.
4. Dopiero osobne zatwierdzenia zapisów/migracji/deploymentu i później aktywacji v2.

Audyt zakończony. Stan kodu, istniejące raporty i dowody zachowano. Nie wykonano napraw, stagingu, commita, push, deploy, migracji, seedów ani zdalnych operacji. Dalsze kroki pozostają propozycją do akceptacji.

## Aneks: pełny status plików i kwalifikacja

Poniższy inwentarz zawiera wszystkie 237 wejściowych zmian oraz nowy raport. ` M` oznacza unstaged tracked modification; `??` untracked. Index jest pusty. Obszary I/D/U oznaczają i18n/DnD/Unicode, L lokalne tooling/izolację, T ThemeProvider, B benchmark harness, P prywatne wykluczenie, A ten audyt. Pliki współdzielone mają kilka oznaczeń. „Rdzeń” oznacza gotową implementację w opisanym zakresie z wymaganymi zależnościami; „walidacja/zakres” oznacza konieczność jawnego włączenia i zamknięcia walidacji przed deklaracją kompletności. Ta tabela nie autoryzuje stagingu.

| Git | Plik | Obszar | Kwalifikacja |
| --- | --- | --- | --- |
| ` M` | `.codex/config.toml` | P | WYKLUCZYĆ |
| ` M` | `.env.example` | U+L | Rdzeń; zależności |
| ` M` | `.gitignore` | L | Walidacja / zakres narzędzi |
| ` M` | `drizzle.config.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `drizzle/meta/_journal.json` | U | Rdzeń; zależności |
| ` M` | `next.config.ts` | I+L | Rdzeń; zależności |
| ` M` | `package.json` | I+L | Rdzeń; zależności |
| ` M` | `playwright.local-supabase.config.ts` | D+L | Rdzeń; zależności |
| ` M` | `pnpm-lock.yaml` | I | Rdzeń; zależności |
| ` M` | `pnpm-workspace.yaml` | I | Rdzeń; zależności |
| ` M` | `src/app/(platform-admin)/admin/layout.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/(public)/events/[slug]/error.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/(public)/events/[slug]/loading.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/(public)/events/[slug]/not-found.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/(public)/events/[slug]/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/(public)/events/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/(public)/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/account/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/account/security/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/auth/invite/accept/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/dashboard/new/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/dashboard/onboarding/profile/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/dashboard/org/[organizationId]/events/[eventId]/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/dashboard/org/[organizationId]/events/[eventId]/participants/loading.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/dashboard/org/[organizationId]/events/[eventId]/participants/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/dashboard/org/[organizationId]/events/[eventId]/queue/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/dashboard/org/[organizationId]/events/[eventId]/settings/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/dashboard/org/[organizationId]/events/[eventId]/share/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/dashboard/org/[organizationId]/events/new/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/dashboard/org/[organizationId]/events/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/dashboard/org/[organizationId]/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/dashboard/org/[organizationId]/settings/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/dashboard/org/[organizationId]/team/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/dashboard/organizations/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/dashboard/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/dashboard/queue/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/join/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/layout.tsx` | I+L | Rdzeń; zależności |
| ` M` | `src/app/s/[token]/layout.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/setup/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/sign-in/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/app/sign-up/page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/app-shell/app-shell.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/app-shell/app-sidebar-user.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/app-shell/app-sidebar.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/app-shell/sidebar-navigation.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/app-shell/site-header.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/archive-organization-form.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/close-event-confirmation.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/create-event-form.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/dashboard-organization-switcher.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/dashboard-runtime-error.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/dashboard-shell.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/dashboard-skeletons.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/event-management-panel.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/event-overview.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/event-participants-panel.tsx` | I+U | Rdzeń; zależności |
| ` M` | `src/components/operator/event-queue-api.ts` | D | Rdzeń; zależności |
| ` M` | `src/components/operator/event-queue-panel.tsx` | I+D | Rdzeń; zależności |
| ` M` | `src/components/operator/event-session-access-panel.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/event-workspace-header.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/fair-queue-control.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/general-join-access-panel.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/login-form.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/operator-profile-onboarding-form.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/organization-overview-view.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/organizer-sidebar.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/participant-merge-panel.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/setup-forms.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/signup-form.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/operator/unauthorized-sign-in.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/participant-merge-preview.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/platform-admin/admin-access-denied.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/platform-admin/admin-error-state.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/platform-admin/admin-imports-panel.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/platform-admin/admin-imports-skeleton.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/platform-admin/admin-overview-skeleton.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/platform-admin/admin-overview.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/platform-admin/admin-shell.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/platform-admin/admin-sidebar.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/catalog-song-list.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/current-queue-song-bar.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/discovery-home-page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/event-card.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/event-carousel.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/event-search-form.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/join-code-gate.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/participant-identity-dialog.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/participant-join-gate.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/participant-profile-drawer.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/public-request-page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/public-session-entry-shell.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/public-session-lifecycle.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/public-site-header.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/session-catalog-collections.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/session-catalog-genres.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/session-code-form.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/session-discovery-home.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/session-participant-requests.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/session-queue-list.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/session-queue-panel.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/session-request-page.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/session-search-results.tsx` | I+U | Rdzeń; zależności |
| ` M` | `src/components/public/session-shell-header.tsx` | I+U | Rdzeń; zależności |
| ` M` | `src/components/public/session-song-artwork.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/session-song-row.tsx` | I+U | Rdzeń; zależności |
| ` M` | `src/components/public/session-state-alert.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/public/song-details-drawer.tsx` | I+U | Rdzeń; zależności |
| ` M` | `src/components/public/validation.ts` | U | Rdzeń; zależności |
| ` M` | `src/components/request-status-badge.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/theme-provider.tsx` | T | Poprawka; historyczny smoke |
| ` M` | `src/components/theme-switcher.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/ui/breadcrumb.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/ui/carousel.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/ui/dialog.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/ui/sheet.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/ui/sidebar.tsx` | I | Rdzeń; zależności |
| ` M` | `src/components/ui/sonner.tsx` | I | Rdzeń; zależności |
| ` M` | `src/db/admin-database-url.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `src/db/backfill-song-public-id.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `src/db/check-db-state.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `src/db/import-ising.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `src/db/import-karafun-csv.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `src/db/ising-mapping.ts` | U | Rdzeń; zależności |
| ` M` | `src/db/karafun-mapping.ts` | U | Rdzeń; zależności |
| ` M` | `src/db/link-operator-auth.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `src/db/link-workspace-member.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `src/db/schema.ts` | U | Rdzeń; zależności |
| ` M` | `src/db/seed-catalog-collections.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `src/db/seed-operator.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `src/db/seed.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `src/lib/song-search-cursor.ts` | U | Rdzeń; zależności |
| ` M` | `src/lib/song-search.ts` | U | Rdzeń; zależności |
| ` M` | `src/lib/supabase/admin.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `src/proxy.ts` | I | Rdzeń; zależności |
| ` M` | `src/server/database-connection-config.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `src/server/operator-api/event-queue-validation.ts` | D | Rdzeń; zależności |
| ` M` | `src/server/operator-api/event-queue.ts` | D | Rdzeń; zależności |
| ` M` | `src/server/platform-admin/import-worker-process.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `src/server/public-api/validation.ts` | U | Rdzeń; zależności |
| ` M` | `src/server/session-api/identity-http.ts` | D | Rdzeń; zależności |
| ` M` | `src/server/session-api/service.ts` | U | Rdzeń; zależności |
| ` M` | `src/server/song-search.ts` | U | Rdzeń; zależności |
| ` M` | `tests/dashboardOrganizationRouting.test.ts` | I | Rdzeń; zależności |
| ` M` | `tests/databaseConnectionConfig.test.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `tests/e2e/e2e-env.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `tests/e2e/local-supabase-fixture.ts` | D+L | Rdzeń; zależności |
| ` M` | `tests/e2e/public-event-session-identity.local.spec.ts` | D+L | Rdzeń; zależności |
| ` M` | `tests/e2e/run-local-supabase-smoke.ts` | D+L | Rdzeń; zależności |
| ` M` | `tests/eventQueueManagement.test.ts` | I | Rdzeń; zależności |
| ` M` | `tests/interactionFeedback.test.ts` | I | Rdzeń; zależności |
| ` M` | `tests/participantLinkingMigration.test.ts` | U | Rdzeń; zależności |
| ` M` | `tests/postgres/faultProcessHarness.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `tests/postgres/participantIdentity.integration.test.ts` | D | Rdzeń; zależności |
| ` M` | `tests/postgres/postgresDriverFault.worker.mjs` | L | Walidacja / zakres narzędzi |
| ` M` | `tests/postgres/postgresTestHarness.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `tests/postgres/songSearchAdversarial.review.test.ts` | U | Rdzeń; zależności |
| ` M` | `tests/postgres/songSearchQuality.integration.test.ts` | U | Rdzeń; zależności |
| ` M` | `tests/postgres/songSearchSqlApiUi.integration.test.tsx` | U | Rdzeń; zależności |
| ` M` | `tests/publicClientValidation.test.ts` | U | Rdzeń; zależności |
| ` M` | `tests/publicEvents.test.ts` | I | Rdzeń; zależności |
| ` M` | `tests/vitest/admin-shell.component.test.tsx` | I | Rdzeń; zależności |
| ` M` | `tests/vitest/admin-theme-switcher.component.test.tsx` | I | Rdzeń; zależności |
| ` M` | `tests/vitest/app-shell-navigation.component.test.tsx` | I | Rdzeń; zależności |
| ` M` | `tests/vitest/event-queue-panel.component.test.tsx` | D | Rdzeń; zależności |
| ` M` | `tests/vitest/import-worker-runtime.test.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `tests/vitest/session-shell-header.component.test.tsx` | I | Rdzeń; zależności |
| ` M` | `tests/vitest/setup.ts` | I | Rdzeń; zależności |
| ` M` | `tests/vitest/song-search.test.ts` | U | Rdzeń; zależności |
| ` M` | `tsconfig.json` | L | Walidacja / zakres narzędzi |
| ` M` | `vitest.config.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `vitest.db-contention.config.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `vitest.db-timeouts.config.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `vitest.postgres.config.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `vitest.public-session-postgres.config.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `vitest.song-search-postgres.config.ts` | L | Walidacja / zakres narzędzi |
| ` M` | `vitest.song-search-review.config.ts` | L | Walidacja / zakres narzędzi |
| `??` | `docs/architecture/adr-queue-drag-and-drop.md` | D | Rdzeń; zależności |
| `??` | `docs/architecture/adr-unicode-song-search.md` | U | Rdzeń; zależności |
| `??` | `docs/features/enterprise-drag-and-drop.md` | D | Rdzeń; zależności |
| `??` | `docs/features/internationalization-pl-en.md` | I | Rdzeń; zależności |
| `??` | `docs/features/local-development-isolation.md` | L | Walidacja / zakres narzędzi |
| `??` | `docs/features/post-i18n-unicode-integration-audit.md` | A | Raport audytu |
| `??` | `docs/features/universal-multilingual-song-search.md` | U | Rdzeń; zależności |
| `??` | `docs/runbooks/unicode-song-search-rollout.md` | U | Rdzeń; zależności |
| `??` | `drizzle/0031_unicode_song_search.sql` | U | Rdzeń; zależności |
| `??` | `drizzle/meta/0031_snapshot.json` | U | Rdzeń; zależności |
| `??` | `playwright.queue-performance.config.ts` | B | Walidacja / zakres benchmarku |
| `??` | `scripts/backfill-unicode-song-search.ts` | U | Rdzeń; zależności |
| `??` | `scripts/generate-unicode-search-sql.ts` | U | Rdzeń; zależności |
| `??` | `scripts/isolated-environment.ts` | L | Walidacja / zakres narzędzi |
| `??` | `scripts/local-development.ts` | L | Walidacja / zakres narzędzi |
| `??` | `scripts/local-environment-files.ts` | L | Walidacja / zakres narzędzi |
| `??` | `scripts/local-next.ts` | U+L | Rdzeń; zależności |
| `??` | `scripts/provision-local-worker.ts` | L | Walidacja / zakres narzędzi |
| `??` | `scripts/seed-local-development.ts` | L | Walidacja / zakres narzędzi |
| `??` | `scripts/test-target-bootstrap.ts` | L | Walidacja / zakres narzędzi |
| `??` | `scripts/verify-local-development.ts` | L | Walidacja / zakres narzędzi |
| `??` | `src/app/api/dashboard/organizations/[organizationId]/events/[eventId]/queue/requests/[requestId]/placement/route.ts` | D | Rdzeń; zależności |
| `??` | `src/components/language-switcher.tsx` | I | Rdzeń; zależności |
| `??` | `src/components/operator/queue-drag-board.tsx` | I+D | Rdzeń; zależności |
| `??` | `src/db/song-search-backfill.ts` | U | Rdzeń; zależności |
| `??` | `src/i18n/app-intl-provider.tsx` | I | Rdzeń; zależności |
| `??` | `src/i18n/locale.ts` | I | Rdzeń; zależności |
| `??` | `src/i18n/messages/en.json` | I | Rdzeń; zależności |
| `??` | `src/i18n/messages/pl.json` | I | Rdzeń; zależności |
| `??` | `src/i18n/messages/uk.json` | I | Rdzeń; zależności |
| `??` | `src/i18n/request.ts` | I | Rdzeń; zależności |
| `??` | `src/i18n/server.ts` | I | Rdzeń; zależności |
| `??` | `src/i18n/source-index.json` | I | Rdzeń; zależności |
| `??` | `src/i18n/text.ts` | I | Rdzeń; zależności |
| `??` | `src/i18n/use-ui-text.ts` | I | Rdzeń; zależności |
| `??` | `src/lib/UNICODE-LICENSE.txt` | U | Rdzeń; zależności |
| `??` | `src/lib/local-target.ts` | L | Walidacja / zakres narzędzi |
| `??` | `src/lib/queue-placement.ts` | D | Rdzeń; zależności |
| `??` | `src/lib/song-search-engine.ts` | U | Rdzeń; zależności |
| `??` | `src/lib/unicode-case-fold.json` | U | Rdzeń; zależności |
| `??` | `src/server/song-search-unicode.ts` | U | Rdzeń; zależności |
| `??` | `supabase/config.toml` | L | Walidacja / zakres narzędzi |
| `??` | `tests/e2e/internationalization-locale.local-smoke.mjs` | I | Rdzeń; zależności |
| `??` | `tests/e2e/internationalization.local-smoke.mjs` | I | Rdzeń; zależności |
| `??` | `tests/e2e/queue-drag-performance.local.spec.ts` | B | Walidacja / zakres benchmarku |
| `??` | `tests/e2e/theme-runtime.local.spec.ts` | B | Walidacja / zakres benchmarku |
| `??` | `tests/e2e/unicode-song-search.local-smoke.mjs` | U | Rdzeń; zależności |
| `??` | `tests/fixtures/unicode-song-search.ts` | U | Rdzeń; zależności |
| `??` | `tests/localEnvironment.test.ts` | L | Walidacja / zakres narzędzi |
| `??` | `tests/localEnvironmentFiles.test.ts` | L | Walidacja / zakres narzędzi |
| `??` | `tests/localToolIsolation.test.ts` | U+L | Rdzeń; zależności |
| `??` | `tests/postgres/unicodeSearchTimeout.integration.test.ts` | U | Rdzeń; zależności |
| `??` | `tests/postgres/unicodeSongSearch.integration.test.ts` | U | Rdzeń; zależności |
| `??` | `tests/queuePlacement.test.ts` | D | Rdzeń; zależności |
| `??` | `tests/unicodeSongSearchMigration.test.ts` | U | Rdzeń; zależności |
| `??` | `tests/vitest/internationalization-public-coverage.test.ts` | I | Rdzeń; zależności |
| `??` | `tests/vitest/internationalization.component.test.tsx` | I | Rdzeń; zależności |
| `??` | `tests/vitest/internationalization.test.ts` | I | Rdzeń; zależności |
| `??` | `tests/vitest/queue-placement-routes.test.ts` | D | Rdzeń; zależności |
| `??` | `vitest.song-search-unicode-quality.config.ts` | U | Rdzeń; zależności |
| `??` | `vitest.unicode-search-postgres.config.ts` | U | Rdzeń; zależności |
