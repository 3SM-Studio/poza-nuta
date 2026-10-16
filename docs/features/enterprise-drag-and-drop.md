# Enterprise Drag & Drop

Data: 2026-10-16. Werdykt: **PASS** dla implementacji i wykonanych lokalnych
bramek. Nie jest deklaracją wdrożenia. Dotyk: **NOT VERIFIED ON PHYSICAL DEVICE**.

## Punkt startowy i zakres

Repo `C:/Projects/pozanuta-stage-1`, branch
`feat/kunestu-participant-model-fair-queue`, HEAD/checkpoint Slice 1–5
`721a1dd35caec0666d099024a344628c6e075c1c`. Index pozostaje pusty.
Zastana prywatna zmiana `.codex/config.toml` ma niezmienione bajty/SHA-256;
nie jest częścią zadania. Brak commita, push, PR, deploy i produkcyjnych migracji.
Nie zmieniono brandingu, i18n, Fair Queue engine, schematu, migracji ani patcha
Postgres.js/manifestu/lockfile. Wszystkie bazy testowe są disposable PostgreSQL 17.

Zastosowano personal `codex-prompt-strategist` i cztery referencje read-only
z sąsiedniego pozanuta-social, AGENTS.md i projektowe skille architektury,
backendu, React/Next.js, UI/Radix, bezpieczeństwa, Auth/RBAC, PostgreSQL,
Supabase, Realtime i testów; Impeccable jako refinement istniejącej powierzchni.
Nie zmieniano sąsiedniego repo ani zastanych kopii odtworzeniowych.

## Baseline i przyczyny

Baseline real mouse/keyboard na desktop/mobile: 1/1 PASS, 26,4 s,
PostgreSQL 170006, `dnd-baseline-browser-rerun.log`. Trace zachowano pod
`test-results/local-e2e-failures/2026-10-16T08-32-37-707Z/` (nazwa katalogu
pochodzi ze wspólnego helpera retencji, run był udany). Pierwszy wybór grep
nie znalazł testów; nie uznano go za PASS. Dowody są lokalne i ignorowane.

Baseline potwierdzał ogólną funkcjonalność, lecz nie miał kontraktu BEFORE/AFTER.
W kodzie checkpointu wykryto:

1. `pointerWithin` obejmował jednocześnie kartę i kolumnę; poza nimi
   `closestCorners` wybierał najbliższy cel. Nie było gwarancji anulowania poza
   strefą. Nie przypisujemy każdemu takiemu wyborowi osobnej reprodukcji.
2. `getApprovedDropPosition` używał indeksu karty, niezależnie od jej połowy;
   tło kolumny oznaczało koniec. Wskazówka mówiła tylko „Upuść w sekcji”.
3. Cross-lane approve uruchamiał action, potem osobny move-to-position;
   błąd drugiego POST mógł pozostawić tylko zmianę statusu.
4. Drag do rejected wywoływał `handleAction` bez AlertDialog; potwierdzenie
   istniało wyłącznie dla przycisku.
5. Realtime nie traktował aktywnego gestu jako odrębnego zamiaru; mógł
   wymienić podstawę pozycji przed upuszczeniem. Mutacje były serializowane,
   ale sam gest nie przekazywał expected revision.

## Architektura i kontrakt slotu

Decyzja i porównanie bibliotek: [ADR](../architecture/adr-queue-drag-and-drop.md).
Pozostaje jeden runtime `@dnd-kit/core` 6.3.1. Registry i oficjalna dokumentacja
potwierdziły także `@dnd-kit/react` 0.5.1 z peers React 18/19. Nowe API wymaga
wymiany provider/events/hooks/sensors i nie rozwiązuje atomowości domeny.
Nie zainstalowano drugiego silnika. Istniejące pakiety sortable/utilities w
manifestach zachowano, ale nowa powierzchnia ich nie importuje.

`queue-placement.ts` określa czysty `QueuePlacement { lane, position }`.
Pozycja approved jest **1-based po usunięciu źródła**. Górna połowa karty
wybiera slot przed nią; dolna połowa i dokładny midpoint wybierają slot za nią.
Wysokość każdej karty pochodzi z jej rect, bez stałej wysokości lub wymiarów
overlay. Puste approved ma wyłącznie pozycję 1. Tło wewnątrz body kolumny
wybiera slot na tej samej podstawie; nagłówek i obszar poza body/viewportem
nie są targetami. Nie ma fallbacku poza strefą.

Slot jest rzeczywistym droppable z `lane`, `position`, `allowed`. Ten sam
obiekt wyznacza collision, insertion indicator, komunikat SR i payload POST.
Nie istnieje osobny dekoracyjny algorytm wskaźnika. Podczas gestu źródło
zachowuje miejsce, co chroni geometrię przed przejściowymi zmianami layoutu.
Pusty placeholder zachowuje również 12 px slotu źródła. Komunikaty celu,
zapisu i anulowania są portalami poza układem planszy; ich pojawienie/ukrycie
nie może przesunąć źródła lub targetu. Badge synchronizacji i usuwanie alertu
nie zmieniają układu podczas aktywnego gestu. Sąsiad przy slocie odsuwa się o 3 px; pomiar dnd-kit ignoruje transform.
Scroll używa viewport rects i aktualnych współrzędnych sensora.

Pending i rejected nie mają ręcznej kolejności w domenie: pending pozostaje
według createdAt, rejected według updatedAt. Ich wskaźniki mówią o przywróceniu
lub potwierdzanym odrzuceniu, a nie o fikcyjnej pozycji. Now, done i skipped
nie są źródłami/strefami drag. Niedozwolone same-lane pending/rejected pokazują
odmowę i nie wysyłają POST.

## Zapis, RBAC i Fair Queue

Nowy endpoint:
`POST /api/dashboard/organizations/[organizationId]/events/[eventId]/queue/requests/[requestId]/placement`.
Body: `lane`, `position`, `expectedRevision`, opcjonalne `confirmed: true`.
Walidacja jest ścisła: obce pola/role/order, ułamki, błędne statusy, brak
potwierdzenia rejected i nieprawidłowy version vector są odrzucane.
Streaming body ma limit 260000 bajtów; sam revision 250000 znaków.
Istniejący identity body reader ma opcjonalny limit, domyślne 1024 pozostaje.

HTTP używa istniejącego wrappera: zweryfikowana sesja operatora, same-origin
JSON/CSRF, identyfikatory, safe errors, no-store. Backend powtarza lokalny
membership/RBAC, scope event/workspace, lifecycle i uzyskuje istniejący
event-session mutex (lub legacy event lock). Dopiero potem porównuje dokładny
revision `id:version:status:position` wszystkich wierszy. Nie jest to hash
z ryzykiem kolizji; nie zawiera PII. 409 `QUEUE_PLACEMENT_STALE` wymaga nowego
zamiaru operatora. Nie ma automatycznego replay.

Manual placement korzysta z tej samej transakcji action i jej admission guards:
duplicate, 2/2, statusy, renumber, wersje i audit. Jawny approved wstawia ID na
wskazany indeks wśród pozostałych approved; wszystkie inne pary pozostają.
Zmiana statusu, porządek, anchoring legacy i audit zatwierdzają się razem.
Awaria audytu wycofuje wszystko. Manual reorder już approved nie dopisuje
fałszywego nowego approval timestamp; audit to `event_queue_manual_drop`.
Cross-lane approval zachowuje `event_queue_approve` z `manualDrop` i pozycją.
Zwykły przycisk approve nadal uruchamia niezmieniony Fair Insert. Jawny Fair Sort
pozostaje niezależny. Now nigdy nie jest przemieszczane przez endpoint placement.

## UI, konflikt i odzyskiwanie

Nowy board oddziela sensory/geometrię od istniejącego panelu, API i kolejki
optimistic operations. Snapshot jest utrwalony na dragStart. Realtime podczas
gestu pobiera canonical API. Zmieniony version vector natychmiast unieważnia
generację, usuwa overlay i pokazuje wyjaśnienie. Identyczny reconnect
refetch zachowuje gest i jego DOM. Tak samo działa rzeczywista zmiana przez
innego operatora lub Fair Sort. Nie odmontowujemy aktywnego DndContext: sensor
zachowuje obsługę fizycznego up/cancel, ale nie może już zapisać starego zamiaru;
auto-scroll anulowanego gestu jest wyłączony. Następny gest zaczyna nową generację.
Fair Sort, refresh i nowe gesty są blokowane podczas lokalnego zapisu/gestu.

Upuszczenie w approved wysyła jeden POST. Optimistic projection obejmuje cały
status i pozycje; odpowiedź zastępuje podstawę pełną kolejką kanoniczną.
Przyciski góra/dół również otrzymują pełny stan. Pending operations i request
generation chronią przed spóźnionym GET. Przy błędzie projekcja jest usuwana,
feedback pozostaje, refetch rozstrzyga aktualny stan. Utracona odpowiedź nie
oznacza automatycznego ponowienia, które mogłoby przestawić nowszą kolejkę.

Drop do rejected otwiera AlertDialog; bez confirm brak mutacji i brak optimistic
odrzucenia. Cancel zachowuje stan. Po zakończeniu/anulowaniu przywracany jest
focus na kartę, bez globalnego querySelector poza panelem.

Mouse: tylko uchwyt, 6 px activation. Touch: uchwyt, 250 ms hold, 8 px tolerance;
scroll na treści karty nie podnosi zgłoszenia. Dnd-kit autoscroll pozostaje
aktywny. Keyboard: Space, strzałki slotów/sekcji, Home/End i Escape.
Home/End przewijają wybrany slot i zachowują jego logiczny ID podczas scrollu.
Komunikaty SR są po polsku; dozwolony/odmowny cel ma także tekst, nie sam kolor.
Focus wraca bez automatycznego scroll jump; oczekujący focus starszej operacji
jest anulowany na początku nowego gestu. Zamknięcie dragowego AlertDialog ma
jawny close-autofocus na kartę także po dłuższym otwarciu/anulowaniu. Focus ring
i przyciski góra/dół pozostają. Overlay 140 ms, reduced-motion 0 ms;
transitions/transforms są wyłączane przez motion-reduce.

Podczas ruchu wskaźnika nie zapisujemy współrzędnych w React state. Zmienia się
wyłącznie target przy przekroczeniu slotu. Board nie aktualizuje parenta przy
każdym ruchu, DraggableRow jest memoized; pozycje slotów są mapą bez O(n²)
findIndex podczas renderu. Nie dodano interwałów pollingu ani nowych zależności.

## Dowody i regresje

Wstępne kontrole po implementacji: 405 Node + 600 Vitest (54 pliki) PASS;
14 nowych testów geometrii/rewizji/validation w części Node. Panel i route
placement łącznie 57/57 PASS. Nowe testy obejmują rzeczywiste error/rollback,
potwierdzenie cancel/confirm, single POST, kanoniczne pozycje i Realtime abort.
Przestarzałe testy `closestCorners`/dwóch POST zastąpiono testami nowego kontraktu,
nie pozostawiono testów potwierdzających znane błędne zachowanie.

Pełna integracja PostgreSQL 17: 54/54 PASS, 5 plików, 171,94 s
(`dnd-postgres-full.log`). Zawiera 47 zastanych regresji Slice 1–5/driver i
7 nowych DnD: atomic canonical/audit, denial/2/2/rollback oraz real mutex races
drop/drop, drop/approve, drop/move, drop/start, drop/fair. Żadna migracja testowa
nie zawiodła. Brak PostgreSQL 15/16.

Dodatkowe integracje PG17: migration 0027 9/9, guest queue 2/2,
DB contention 4/4 i timeout/failure 3/3 PASS. Osobny ponowny test historii
akceptacji po manual reorder: 1/1 PASS (27 pozostałych przypadków odfiltrowanych;
pełne 28 przypadków tego pliku zawiera wcześniejszy przebieg 54/54).
Wszystkie 37 plików zainstalowanego sterownika są identyczne z zachowaną
czystą instalacją checkpointu; patch SHA pozostaje zgodne. Trzy wcześniej
opisane archiwa kopii bezpieczeństwa nadal istnieją i nie były modyfikowane.

Końcowy pełny browser E2E: **12/12 PASS, 7,5 min**, bez retries,
`dnd-browser-verified.log`, PostgreSQL 170006. Nowy Enterprise desktop:
27,8 s; emulowany touch: 8,0 s. Zastany mouse/keyboard desktop/mobile:
20,5 s. Fair Queue karaoke: 58,4 s, apply-to-public Realtime refetch 446 ms
(pojedynczy pomiar lokalny, nie SLA). Pozostałe scenariusze pokrywają
linkowanie/merge, Presence/TTL, zarządzanie uczestnikami, limit 2/2,
katalog i lifecycle. Test konkurencji UI używa dwóch kart operatora tej
samej zalogowanej sesji; niezależne transakcje i RBAC sprawdzają integracje PG.
Pełny udany trace zachowano lokalnie w
`test-results/local-e2e-failures/2026-10-16T09-59-57-925Z/`.

Końcowe bramki uruchomiono sekwencyjnie po zakończeniu i sprzątnięciu E2E:

| Bramka | Wynik | Lokalny dowód w `.artifacts/` |
| --- | --- | --- |
| `pnpm test` | PASS — Node 405/405, Vitest 601/601, 54 pliki | `dnd-verified-test.log` |
| `pnpm typecheck` | PASS | `dnd-verified-typecheck.log` |
| `pnpm lint` | PASS | `dnd-verified-lint.log` |
| `pnpm build` | PASS — Next 16.3.0, nowy endpoint wykryty jako dynamiczny | `dnd-verified-build.log` |
| `git diff --check` | PASS, ponowione po finalizacji dokumentacji | `dnd-verified-diff-check.log` |

Kod aplikacji i backendu pozostał identyczny z testowanym snapshotem.
Późniejsze poprawki obejmowały tylko helper auto-scroll/oczekiwanie po reloadzie
w E2E (zweryfikowane pełnym 12/12), właściwy reason `reconnect` w teście
komponentowym (zweryfikowany końcowymi bramkami) i ten handoff/ADR.
Index nadal pusty; 18 plików zadania (11 zmodyfikowanych i 7 nowych),
plus zastana prywatna delta `.codex/config.toml`. Wszystkie nowe pliki opisano
poniżej. Nie pojawiły się inne nieignorowane pliki robocze.

Wczesne błędy naprawiano jawnie: mock dnd-kit nie udostępniał nowych sensorów;
nowe testy dostosowano bez wyłączania istniejących regresji. TypeScript wykrył
nieobsługiwane `exact` w Testing Library, usunięto tę opcję. ESLint refs wymagał
destrukturyzacji hooka. Browser wykrył błąd End poza viewportem, naprawiony
logicznym ID slotu. Pierwszy scenariusz konfliktu w teście rozpoczynał kolejny
gest podczas oczekującej invalidacji Fair Sort; poprawny test wymusza konkurencję
po pointer-up przed CAS, żeby zweryfikować 409 zamiast race'u setupu.

Przy invalidacji wykryto również opóźniony callback starego sensora po remount
i problem rozpoczęcia następnego gestu; dlatego pozostawiono stabilny DndContext.
Naprawa używa mounted guard w board, generacji gestu w panelu i stabilnej
własności sensorów aż do fizycznego up/cancel. Test wywołuje
zachowany stary callback po invalidacji: brak dialogu i brak POST. E2E sprawdza
również mouse-up po zdalnej zmianie/Fair Sort.

Pełna bramka lint uruchomiona równolegle z `next dev` E2E objęła wygenerowany
`.next-p3-e2e` i zgłosiła błędy artefaktów. Nie zmieniono reguł ESLint ani testów
w celu ich ukrycia; canonical gates są ponawiane po sprzątnięciu lokalnego serwera.
Końcowy typecheck wykrył też nieistniejący reason `focus` w nowym teście;
zastąpiono go rzeczywistym `reconnect` bez rozszerzania typu lub castu.
Po poprawce cały zestaw pięciu bramek uruchomiono ponownie sekwencyjnie.
Testy keyboard czekają na koniec poprzedniej animacji oraz lifted state/indicator
przed Escape lub commit:
bez tego test wysyłał następny klawisz przed podpięciem natywnego listenera.

Zachowany test geometrii wykrył offset 40 px przy następnym drag. Przyczyną
były komunikaty interakcji dodawane/usuwane w normalnym flow nad/pod planszą;
przeniesiono je do portalu i zachowano placeholder slotu. Nie poluzowano
asercji: szerokość/wysokość nadal <2 px, grab offset <3 px. Test później przeszedł
na desktop i małym ekranie z auto-scroll (`dnd-geometry-browser-third.log`,
1/1, 28,3 s). Źródło ostatniego odrzucenia w mobile nie wysyłało POST, gdy
pointer został przy krawędzi i cel dalej się przesuwał. Pomocnik teraz używa
rzeczywistego native auto-scroll do bezpiecznego zakresu 35–65% viewportu,
z ograniczeniem 8 s, a przed mouse-up wymaga właściwego dozwolonego indicatora.
To mocniejsza asercja poprawnego dropu; drop poza strefą nadal nie zapisuje.
Pierwszy pełny przebieg zakończył się 10 PASS, 1 FAIL i 1 not run:
ostatnie porównanie po reloadzie odczytywało DOM przed załadowaniem kolejki.
Zmieniono je na oczekiwanie z identyczną asercją całej kanonicznej kolejności;
ponowiony pełny przebieg przeszedł 12/12. Nie usunięto reloadu ani porównania
z bazą, nie dodano retries do Playwright.

## Porównanie UX przed i po

| Operacja | Baseline | Nowy kontrakt |
| --- | --- | --- |
| Cel | Karta lub cała sekcja, ogólny komunikat | Widoczny slot, BEFORE/AFTER, pozycja po usunięciu źródła |
| Tło/nagłówek/outside | Fallback do closestCorners lub koniec | Body z rzeczywistym slotem; nagłówek/outside = anulowanie |
| Cross-lane approved | Action i późniejszy move | Jeden CAS i jedna transakcja, pełny canonical response |
| Rejected | Drag pomijał dialog | Cancel bez zapisu, explicit confirm, focus wraca na kartę |
| Zdalny zapis | Zmiana podstawy podczas gestu | Zmieniona wersja unieważnia generację, stary mouse-up bez skutków |
| Scroll/overlay | Test coarse działał; brak kontraktu stable flow | Stały placeholder i portaled feedback, zachowane ostre pomiary geometrii |
| Touch | Pointer activation distance | Mouse 6 px, Touch hold 250 ms/8 px, native scroll poza uchwytem |
| Keyboard | Karty/kolumny | Sloty, Home/End, Escape, polskie announcements i focus bez scroll jump |

## Ograniczenia

**NOT VERIFIED ON PHYSICAL DEVICE**. CDP emulation touch nie jest fizycznym
Android/iOS, VoiceOver/TalkBack ani ręczną akceptacją wizualną użytkownika.
Brak deklaracji testów Safari/WebKit lub produkcyjnego PgBouncer/workerd.
Version vector jest liniowy względem event-sized kolejki (limit jawny powyżej);
duże historie wymagają osobnej paginacji/rewizji DB w przyszłym zakresie.
Ręczne statusy pending/rejected nie uzyskują sztucznego rankingu.
Nie wykonano deploymentu, zdalnego pentestu, produkcyjnego Auth/Realtime smoke
ani migracji. Nie zmieniano zaakceptowanej matematyki Fair Queue.

## Zmienione pliki

- `docs/architecture/adr-queue-drag-and-drop.md` — decyzja i kontrakt.
- `docs/features/enterprise-drag-and-drop.md` — ten handoff.
- `src/lib/queue-placement.ts` — sloty, status matrix, revision, komunikaty.
- `src/components/operator/queue-drag-board.tsx` — sensory, geometria, indicator, overlay, keyboard i generacje.
- `src/components/operator/event-queue-panel.tsx` — integracja, atomic optimistic operation, rejection dialog, canonical/Realtime i focus.
- `src/components/operator/event-queue-api.ts` — placement client i pełna odpowiedź move.
- `src/server/operator-api/event-queue.ts` — atomic placement w istniejącym mutexie, stale guard i audit.
- `src/server/operator-api/event-queue-validation.ts` — strict placement schema.
- `src/server/session-api/identity-http.ts` — opcjonalny limit readera, domyślne identity bez zmian.
- `src/app/api/dashboard/organizations/[organizationId]/events/[eventId]/queue/requests/[requestId]/placement/route.ts` — cienki chroniony adapter.
- `tests/queuePlacement.test.ts` — 14 matematycznych/validation testów.
- `tests/vitest/queue-placement-routes.test.ts` — cztery positive/negative API contracts.
- `tests/vitest/event-queue-panel.component.test.tsx` — atomowość, CAS, confirm/cancel, source focus i stare callbacki.
- `tests/postgres/participantIdentity.integration.test.ts` — siedem DnD PG17 contracts/races.
- `tests/e2e/local-supabase-fixture.ts` — odizolowane event-owned DnD dane i różne wysokości.
- `tests/e2e/public-event-session-identity.local.spec.ts` — real mouse, keyboard, CDP touch, Realtime i konflikty; zastany helper kart ma jawne BEFORE.
- `tests/e2e/run-local-supabase-smoke.ts` — opcjonalna retencja udanych trace.
- `playwright.local-supabase.config.ts` — opt-in trace on.

`.codex/config.toml` jest wykluczoną prywatną deltą użytkownika, nie zmianą
implementacyjną. `.artifacts`, trace, screenshoty i kopie nie są stage'owane.

**PASS** — precyzyjny slot i zapis korzystają z jednego kontraktu; status,
pozycje i audit są atomowe. Pełne E2E, PG17 i końcowe bramki przeszły.
Do ręcznej akceptacji pozostają fizyczny Android/iOS i czytniki ekranu;
nie deklarujemy ich weryfikacji ani pomiarów wydajności pod obciążeniem.
Nie ma otwartego błędu z wykonanych scenariuszy. Zmiany pozostają lokalne,
bez commita i bez działań produkcyjnych.


## Narzędzia i usługi

Lokalne PowerShell/Git/Python, pnpm/Node, Vitest/Testing Library, TypeScript,
ESLint, Next, Drizzle i Docker PostgreSQL 17. Testowy Supabase CLI uruchamia
odizolowane lokalne Auth/Realtime/DB; jego project-id i loopback zostały
zweryfikowane w harnessie. Istniejący pozanuta-social i zdalny Supabase bez zmian.
MCP: Context7 dla dnd-kit i Next DevTools (runtime/metadane, compilation issues,
errors). Agent-browser 0.35.1 odczytał lokalny runtime; właściwe autoryzowane
scenariusze realizuje Playwright z losowym fixture Auth. Oficjalna dokumentacja
dnd-kit i registry pnpm posłużyły do wyboru biblioteki. Żadnych zdalnych mutacji.
Runtime Next DevTools: brak compilation issues i session/config errors.
Browser traces zawierają lokalny stan testowej sesji: pozostają ignorowane,
nie należy ich publikować ani dodawać do Git. Brak sekretów w implementacyjnych
plikach/diffie według heurystycznego skanu; nie jest to audyt historii Git.

## Domknięcie integracyjne po i18n — 2026-10-16

**PASS lokalnej integracji DnD.** Pełny bieżący obraz i18n/Unicode/DnD przeszedł
13/13 E2E w jednym przebiegu na zoptymalizowanym buildzie i `next start`,
bez retries (6,0 min). Log: `.artifacts/readiness-e2e-optimized-final.log`;
trace: `test-results/local-e2e-failures/2026-10-16T16-01-50-881Z`.
Nazwa katalogu retencji nie oznacza błędu tego runu.

Zweryfikowano desktop slots/persistence/confirmation/scroll/keyboard/rollback
i konkurencyjnych operatorów (18,6 s), emulowany touch/long press/scroll/
autoscroll/orientacje (4,6 s) i szeroki mouse/keyboard desktop/mobile (17,4 s).
Fair Queue, manual order, stale preview, nowi uczestnicy i Realtime przeszły;
apply-to-public refetch wyniósł 682 ms w jednym lokalnym pomiarze.
Cała macierz obejmuje także 2/2, identity/linking/merge, Presence/TTL i lifecycle.
Aktualne integracje PG17: 54/54 z realnymi wyścigami DnD/Fair Queue i driver
faults; dodatkowo contention 4/4 oraz timeout hierarchy 3/3.

Nie zmieniano produkcyjnej logiki DnD ani matematyki Fair Queue. Runner dostał
optymalizowany tryb dla pełnej suity oraz jawny PL dla polskich selektorów.
Stare testowe `Close toast`/`Close` i nieodmienione „32 piosenek” poprawiono na
obecne przetłumaczone etykiety. Scenariusz zarządzania uczestnikami oczekuje
jednej widocznej planszy, aktywnego Realtime i jednego pasującego wiersza;
nie używa `.first()` do ukrycia duplikatu. Wszystkie pierwotne interakcje,
asercje DB/reload i ścieżki confirm/cancel zachowano. Nie zwiększano timeoutów
ani nie wyłączano błędów. Wcześniejsze nieudane runy i ich przyczyny opisuje
[aktualny handoff](kunestu-production-readiness.md).

Fizyczny tablet, Safari/iOS i VoiceOver/TalkBack nadal **NOT VERIFIED**.
Nie rozszerza się lokalnego PASS na produkcję: rollout ma NO-GO do uzyskania
świeżych dowodów schematu, backup/restore, zgodnego rollbacku i izolacji
produkcyjnego wydarzenia testowego. Plan nie używa Vercel Preview.
Bez commita, pusha, zdalnej migracji i deploymentu.
