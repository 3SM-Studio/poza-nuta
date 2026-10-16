# Participant Model, Slice 2: participant management i zgłoszenia operatora

## Źródła i zakres

Repozytorium lokalne: `C:/Projects/pozanuta-stage-1`, origin:
`https://github.com/3SM-Studio/poza-nuta.git`, branch:
`fix/song-details-drawer-desktop-position`, HEAD:
`9d1fd059c33c28d5679d4ba40037c3897285bb9d`.
Ponownie sprawdzono Git i rzeczywisty diff, także trzy untracked pliki
Slice 1. Początkowy stan: niezacommitowany Slice 1 opisany w
`participant-model-slice-1.md` oraz `.codex/config.toml` użytkownika.
Żadnej z tych zmian nie resetowano, nie staszowano i nie nadpisano.
Nie pobierano zdalnego main ani nie sprawdzano GitHub.

Ponownie odczytano `AGENTS.md`, personalny `codex-prompt-strategist`
z czterema referencjami pod
`C:/Projects/pozanuta-social/.agents/skills/codex-prompt-strategist/`
oraz właściwe skille projektu: architektura, backend, frontend,
shadcn/Radix, DB/migracje, security, Auth/RBAC, Realtime, testy,
Supabase/Postgres i next-dev-loop. Sąsiedniego projektu nie modyfikowano.
Odczytano lokalne dokumenty Next 16.3 dla route handlers i Server/Client
Components. Context7: dokumentacja prywatnych broadcastów i RLS Supabase;
sprawdzono changelog. shadcn MCP: istniejące Dialog/Empty i checklistę.

Zakres kończy się na Slice 2. Nie wykonano rebrandingu Kunestu,
Presence, heartbeat, linking/merge, Fair Queue, YouTube, co-singers ani
autoapproval. Brak nowego równoległego dashboardu lub modelu tożsamości.

## Review gate Slice 1

Werdykt przeglądu faktycznych plików, niezależnie od deklaracji handoff:
**PASS, brak krytycznej regresji blokującej Slice 2**.

| Obszar | Dowód i wniosek |
| --- | --- |
| Aktywujące przejścia | `lib/dashboard-event-queue.ts` dopuszcza restore do pending i rejected → approved; guard w `operator-api/event-queue.ts` obejmuje każde inactive → active. Start ma wyłącznie aktywne źródła. |
| Inne API | Jedyny publiczny insert w `session-api/service.ts` sprawdza guard; legacy request endpoints są wycofane. Pozostałe update'y requestów zmieniają pozycje lub dezaktywują requesty. |
| Współbieżność | Publiczny create i operator action pobierają ten sam event lifecycle lock, następnie mutex event_sessions. Guard i zapis pozostają w jednej transakcji. Ponowne uruchomienie zastanych testów Postgres: 4/4 na 15 i 17. |
| Scope limitu | Guard filtruje eventId + eventParticipantId i nie filtruje source ani nicku. Nieaktywnych statusów nie liczy. |
| UI i Realtime | Licznik używa wspólnej polityki aktywności; błąd mutacji operatora zachowuje się po odświeżeniu w tle. Przejrzano odpowiednie testy UI i realny smoke 2/2. |
| Fixtures | Zmiana generatora E2E na 6 cyfr odpowiada migracji 0027; kod produkcyjny kodów sesji pozostał bez zmian. |
| Migracje/dokumentacja | Slice 1 nie dodawał migracji. Zachowano opisane ograniczenia historycznych null participant ID i danych ponad limit. |

Na wejściu nie było API tworzącego nowe zgłoszenia operatora. Przy dodaniu
takiego API w Slice 2 rozszerzono istniejący guard duplikatów podczas
reaktywacji na każdy request z eventParticipantId, również source=operator.
To zamyka wymaganie nowo osiągalnej ścieżki; nie przydziela specjalnego limitu.

Znana rozbieżność AGENTS.md z migracją 0022 (liczba aktywnych publicznych
wydarzeń) pozostaje opisana w Slice 1. Ta zmiana nie zmienia jej semantyki.

## Model i semantyka

- `participant_identities`: trwała tożsamość; publiczny klient nie otrzymuje
  jej ID z nowego API. Jedna tożsamość może mieć credentials i wiele membership.
- `participant_credentials`: istniejące hashe i HttpOnly cookie. Ręczne
  dodanie nie tworzy credential, tokenu ani fikcyjnej sesji przeglądarkowej.
- `event_participants`: stabilny identyfikator osoby w sesji wydarzenia,
  wskazujący tożsamość. Ręczne dodanie tworzy nową identity + membership
  w jednej transakcji. Konflikt nicku wycofuje także identity i audit.
- `song_requests.event_participant_id`: jedyne powiązanie historii i limitu.
  Nick jest etykietą. Istniejących rekordów null nie przypisuje się po nazwie.
- Aktywne: pending/approved/now, wspólna polityka Slice 1. Zakończone
  występy: obecny status done. `hasPerformed`: istnieje obecny now lub done.
  Cofnięcie done do pending zmniejsza licznik ukończonych występów;
  nie jest to niezmienny ledger historycznych przejść. UI wyjaśnia ten kontrakt.
  Trwała historia wykonań na potrzeby Fair Queue wymaga przyszłej decyzji.

Nowy kod nie zgaduje powiązań, nie łączy osób po nickach i nie ujawnia
online/offline. Ten sam nick w innym wydarzeniu nie przenosi historii.
W tym samym wydarzeniu obowiązuje istniejąca unikatowość z błędem 409
`SESSION_NICKNAME_TAKEN`, również przy public/manual race.

## API i transakcje

Prefiks API:
`/api/dashboard/organizations/[organizationId]/events/[eventId]/participants`.

| Endpoint | Działanie |
| --- | --- |
| GET `/` | Lista membership, nick, activeCount, completedCount, hasPerformed; canManage i ID tematu wydarzenia |
| POST `/` | Ręczne utworzenie nowej osoby; przyjmuje tylko displayName |
| GET `/[participantId]` | Szczegóły i wszystkie powiązane requesty tego wydarzenia |
| GET `/songs?q=...` | Istniejąca wyszukiwarka katalogu po sprawdzeniu dostępu do wydarzenia |
| POST `/[participantId]/requests` | Wyłącznie katalogowy songId, source=operator, actor z sesji serwera |

Nowe adaptery wymagają istniejącej sesji Supabase Auth i lokalnego operatora.
Read wymaga aktywnego membership w organizacji wydarzenia. Viewer może czytać,
nie mutować. Mutacje wymagają owner/manager/operator i aktywnego wydarzenia
przez współdzielony `requireEventQueueManagerContext`, także po oczekiwaniu
na mutex. POST wymaga JSON i kanonicznego origin (w tym istniejącej polityki
Preview). Event UUID i dodatnie bezpieczne participant ID są walidowane.
Nie ma nowego bypassu platform admina ani roli przesłanej przez klienta.

Nowy insert requestu: event SHARE → session FOR NO KEY UPDATE → sprawdzenie
event-scoped membership FOR SHARE → katalogowy songId → aktywny duplikat →
wspólny guard 2/2 → pending insert → audit. Brak wywołań zewnętrznych wewnątrz
transakcji. RequestedBy i createdByOperatorId zawsze pochodzą z serwera.
Ponowienie tego samego utworu nie tworzy drugiego aktywnego requestu.
Audyt: `event_participant_created`, `event_participant_request_created`;
payload ma identyfikatory techniczne, bez nicków i credentials.

Publiczne `/requests/mine` otrzymało flagę `canCancel`. Anulowanie operator
pending było i pozostaje zabronione przez istniejącą usługę publiczną;
UI ukrywa taki przycisk, ale nadal pokazuje request i wlicza go do 2/2.
Nie rozszerzono uprawnień anulowania.

## Interfejs i Realtime

Istniejąca nawigacja wydarzenia ma sekcję „Uczestnicy”, breadcrumb i tytuł.
Widok: lista z lokalnym filtrem, 0/2–2/2, zakończone występy, pierwszy występ,
szczegóły i historia, dialog ręcznego dodania oraz katalogowy wybór utworu.
Nowe zgłoszenie jest pending; operator zatwierdza je w standardowej kolejce.
Nie zastosowano autoapproval ani automatycznego sortowania.

Użyto istniejących foundation components Button, Card, Input/Label, Dialog,
Alert, Badge, Empty, Skeleton i sonner. Klawiatura korzysta z natywnych button,
radio i formularzy; dialog ma tytuł, opis i kontrolę focus. Są loading,
empty, success, conflict i error states. Stare dane pozostają po nieudanym
refetch. Błędy mutacji nie są kasowane przez invalidację w tle.

Nowy prywatny temat `dashboard:event:{eventId}:participants`, event
`participants_changed`, payload tylko eventId/type/operation/changedAt.
Trigger obsługuje join/manual/rename. Istniejący kanał queue aktualizuje
statystyki requestów i historię. Oba powodują refetch API; brak bezpośrednich
odczytów tabel w przeglądarce i brak interval pollingu. Subscribe, reconnect,
focus i jawne odświeżenie są dozwolone. Generacje requestów chronią przed
przestarzałą odpowiedzią po zmianie wyboru.

## Macierz istniejące / zaimplementowane / pozostałe

| Obszar | Istniejące | Slice 2 | Pozostałe |
| --- | --- | --- | --- |
| Identity/session | Identity, hashowane credentials, membership, join, rename | Ręczne tworzenie tego samego modelu bez credential | Verified linking/merge wielu urządzeń |
| Limit/historia | 2/2, request FK, własne requesty | Wspólny limit dla source=public/operator, lista i szczegóły operatora | Ledger/semantyka Fair Queue |
| Panel | Workspace i kolejka wydarzenia | Uczestnicy, filtr, statystyki, ręczne dodanie, katalog za uczestnika | Presence i zaawansowane zarządzanie |
| Realtime | Prywatna kolejka i publiczna invalidacja | Prywatne invalidacje membership z event RBAC | Presence subsystem |
| Historyczne null FK | Czytelne rekordy queue | Zachowane, nie przypisane po nicku | Ewentualne verified przypisanie |
| Piosenki operatora | Istniejący katalog | Pending request z actor i eventParticipantId | External/YouTube, duety |

## Migracja

`0028_event_participants_realtime.sql`, journal i snapshot. Brak zmiany
`src/db/schema.ts`, brak backfillu, nowych required kolumn i usuwania danych.
Runbook: `docs/migrations/0028-event-participants-realtime.md` zawiera
preflight, zapytania weryfikacyjne i rollback/forward-fix.
Migracja była uruchamiana wyłącznie na izolowanych bazach testowych,
nigdy na produkcji ani zdalnym projekcie. Pozostaje bez commita wraz z kodem.

## Weryfikacja i napotkane failures

| Komenda | Wynik |
| --- | --- |
| `pnpm test` | PASS: Node 370/370, Vitest 561/561 w 47 plikach; 0 skipów |
| `pnpm typecheck` | PASS, wykonany po zakończeniu builda i cleanup E2E |
| `pnpm lint` | PASS |
| `pnpm build` | PASS po sekwencyjnym powtórzeniu; Next.js 16.3.0/Turbopack |
| `git diff --check` | PASS |
| `pnpm exec vitest run --config vitest.public-session-postgres.config.ts tests/postgres/participantIdentity.integration.test.ts --silent` | PASS: 6/6 na Postgres 15 i 17, pełne migracje 0–28 dla Slice 2 |
| `pnpm exec vitest run tests/vitest/event-participants-routes.test.ts tests/vitest/event-participants-panel.component.test.tsx tests/vitest/use-queue-realtime.test.tsx` | PASS: 16/16 targeted |
| `$env:LOCAL_E2E_PLAYWRIGHT_GREP='manages'; pnpm test:e2e:public-event-session-identity-local` | PASS 1/1; końcowy join invalidation 1391 ms, test 35,1 s |
| `$env:LOCAL_E2E_PLAYWRIGHT_GREP='2/2'; pnpm test:e2e:public-event-session-identity-local` | PASS 1/1; końcowa aktualizacja limitu przez Realtime 1490 ms, test 25,0 s |

Testy realnego Postgresa obejmują manual participant bez credential,
konflikt nicku z rollbackiem identity, historię po ID, liczniki now/done
i cofnięcie done, operator actor/audit, duplikat operatora, wspólny limit
przy public/operator race z barierą na mutexie, inny event, istniejącą obcą
organizację, viewer bez mutacji, rename bez zmiany historii i legacy null FK.
Nowy kanał sprawdzono przez prawdziwe SELECT z RLS jako authenticated/anon:
własny członek i viewer widzą invalidację; obca organizacja, anon, suspended
user i inactive membership nie. Payload triggera ma dokładnie cztery
dozwolone klucze. Zgłoszenie operatora w publicznym API ma canCancel=false.

Pierwszy browser smoke pokrył join przez QR do otwartego widoku operatora,
0/2 → 1/2 → 2/2 wspólnie z publicznym requestem, błąd trzeciego, done
zwalniające miejsce przez realny Realtime, zachowanie błędu po broadcastzie,
manual participant i request, reload oraz mobilne 390 px bez overflow.
Końcowe powtórzenie smoke zarządzania uczestnikami również przeszło:
join invalidation 1391 ms. Osobny smoke 2/2 przeszedł po poprawce interakcji
z toastem, aktualizacja limitu przez Realtime 1490 ms, poniżej 5 s.
Cała pozostała suite E2E i produkcja: NOT VERIFIED, poza zakresem.

Next DevTools MCP: wykrycie serwera/trasy, `get_compilation_issues` i
`get_errors` bez błędów. Agent-browser 0.35.1: preflight, strona publiczna,
snapshot i React tree. Po buildzie stary browser stracił renderer React;
osobna sesja slice2 otwarta ponownie poprawnie wykonała introspekcję.
Funkcjonalny dowód nowego przepływu pochodzi z Playwright i realnego Realtime.

MCP/tools: Next DevTools, Context7, shadcn, shell/pnpm, Docker/Postgres 15/17,
izolowany lokalny Supabase CLI 2.109.1 z Auth/Realtime/Postgres 17,
Playwright, agent-browser; dokumentacja Supabase (changelog pobrany HTTP,
prywatne broadcasty/RLS przez Context7). Brak zdalnego Supabase MCP,
GitHub, Vercel i Cloudflare. Runner sprząta wyłącznie własne testowe zasoby.

W trakcie prac:
- Lint wskazał synchroniczne uruchamianie refetch w efekcie. Widok korzysta
  teraz z danych SSR, invalidacji subscribe i refetch w handlerze wyboru;
  effect rejestruje wyłącznie focus i cleanup. Reguły lint nie wyłączono.
- Testy nawigacji oczekiwały czterech linków. Dodano „Uczestnicy”, poprawny
  breadcrumb i test aktywnego linku, zachowując asercję jednego zestawu nawigacji.
- Test „0027 is latest” wymagał zmiany na trwałe zachowanie wpisu 0027;
  nowy test weryfikuje 0028 i brak zmian biznesowego snapshotu.
- W dodatkowych testach RLS uzupełniono lokalną compatibility fixture o
  USAGE schematu realtime i pełne pola stanu zawieszenia. Nie osłabiono RLS.
- Aktualizacja canCancel wymagała uzupełnienia fixture i mocków publicznych
  requestów. Testy nadal sprawdzają rzeczywiste anulowanie publicznego pending.
- Próba wspólnego smoke filtrem `manages|2/2` dała „No tests found” w runnerze
  Windows. Oba testy są uruchamiane oddzielnie.
- Osobny smoke 2/2 zatrzymał się na kliknięciu zakładki „Moje”, zasłoniętej
  przez powiadomienie sukcesu. Trace pokazał przechwytywanie kliknięcia przez
  toast, utrzymywany pod kursorem. Uzupełniono istniejący helper wysłania
  utworu o widoczne potwierdzenie sukcesu i zwykłe kliknięcie Close toast
  przed wyborem zakładki. Bez forced clicks, skipów i zmian globalnego UI.
- Równoległy build podczas cleanup E2E trafił w generowane `.next-p3-e2e`
  types i nie przeszedł. Zatrzymano edycje i powtórzono sam build po cleanup;
  docelowe bramki build/typecheck i E2E są wykonywane sekwencyjnie.
- Ostatni odczyt działającego długo serwera dev 3000 wykazał niepoprawne
  znaki w wygenerowanym CSS Tailwinda. Źródłowy `globals.css` nie był zmieniany.
  Restart własnego procesu dev bez zmian kodu i bez usuwania cache przywrócił
  poprawne działanie: `get_compilation_issues` zwrócił pustą listę,
  `get_errors` puste configErrors/sessionErrors, a przeglądarka poprawnie
  wyrenderowała stronę publiczną. Przyczynę w pamięci skanera/cache podejrzewamy,
  ale nie została osobno dowiedziona; nie wprowadzano obejścia w CSS.

## Bezpieczeństwo i ograniczenia

Auth cookies/tokens, lokalne `.env`, `data`, konfiguracja i usługi produkcyjne
nie były zmieniane. Brak commita/push/merge/deploy i operacji GitHub/Vercel.
Nowe API nie zwraca credential ani participantIdentityId, a prywatny broadcast
nie zawiera danych osobowych. Mutacje są audytowane i objęte transakcjami.

Ograniczenia: brak Presence i linking/merge; ręczny uczestnik nie może teraz
samodzielnie przejąć identity na telefonie. Czytanie listy/historii nie ma
jeszcze paginacji, co jest wystarczające dla lokalnego wydarzenia; duże
wydarzenia wymagają pomiaru i ewentualnego kolejnego slice'a. CompletedCount
opisuje bieżące statusy, nie wszystkie historyczne uruchomienia utworu.
Historyczne null FK i dane ponad 2/2 nie są automatycznie naprawiane.
Gwarancja limitu dotyczy ścieżek aplikacji używających wspólnego mutexu;
administracyjne SQL i przyszły merge wymagają tego samego kontraktu.
Autoryzacja kanału Supabase jest sprawdzana podczas subscribe, więc istniejące
połączenie nie zastępuje autoryzacji każdego odczytu API po odebraniu sygnału.

## Następny etap: Presence

1. Przed kodem ponownie sprawdzić Git, diff obu slice'ów i stan migracji.
2. Ustalić tabelę połączeń eventParticipantId/connectionId na kartę, bez
   fingerprintingu i ujawniania identyfikatorów publicznie.
3. Heartbeat około 15 s; TTL offline 35–45 s liczony serwerowo. Osobny
   lifecycle połączenia, best-effort pagehide/sendBeacon.
4. Status osoby agregować przez wszystkie karty i credentials urządzeń.
   Zamknięcie jednej z dwóch kart nie może dać offline. Offline nie usuwa
   membership, requestów ani historii.
5. API sprawdza HttpOnly credential, event membership i origin; dashboard
   nadal używa istniejącego RBAC. Sygnały online/offline minimalne i prywatne.
6. Testy realnego Postgresa: wygasanie i równoczesne heartbeat/close. Browser:
   dwie karty, kilka urządzeń, refresh, reconnect, TTL i cancel best-effort.
7. Nie implementować jednocześnie linking/merge, Fair Queue lub rebrandingu.
   Zamknąć etap pełnymi checks i smoke na izolowanym środowisku.

## Pliki Slice 2

Nowe:
- `src/server/operator-api/event-participants.ts`
- `src/server/operator-api/event-participants-http.ts`
- `src/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/route.ts`
- `src/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/[participantId]/route.ts`
- `src/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/[participantId]/requests/route.ts`
- `src/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/songs/route.ts`
- `src/app/dashboard/org/[organizationId]/events/[eventId]/participants/page.tsx`
- `src/app/dashboard/org/[organizationId]/events/[eventId]/participants/loading.tsx`
- `src/components/operator/event-participants-api.ts`
- `src/components/operator/event-participants-panel.tsx`
- `drizzle/0028_event_participants_realtime.sql`
- `drizzle/meta/0028_snapshot.json`
- `tests/eventParticipantsRealtimeMigration.test.ts`
- `tests/vitest/event-participants-routes.test.ts`
- `tests/vitest/event-participants-panel.component.test.tsx`
- `docs/migrations/0028-event-participants-realtime.md`
- `docs/features/participant-model-slice-2.md`

Rozszerzone:
- `src/server/operator-api/event-queue.ts`: współdzielony kontekst mutation,
  ochrona operator active duplicate przy reaktywacji.
- `src/server/session-api/service.ts`: canCancel własnych publicznych requestów.
- `src/lib/dashboard-routes.ts`, `src/lib/queue-realtime.ts`
- `src/components/realtime/use-queue-realtime.ts`
- `src/components/operator/dashboard-shell.tsx`, `organizer-sidebar.tsx`
- `src/components/public/session-api.ts`, `session-participant-requests.tsx`,
  `public-session-visual-fixture.tsx`: jawne canCancel.
- `drizzle/meta/_journal.json`
- `tests/postgres/participantIdentity.integration.test.ts`
- `tests/e2e/public-event-session-identity.local.spec.ts`
- `tests/vitest/app-shell-navigation.component.test.tsx`,
  `use-queue-realtime.test.tsx`, `session-request-feedback.component.test.tsx`
- `tests/sessionCodeSixDigitsMigration.test.ts`

Pozostałe brudne pliki należą do początkowego Slice 1 lub użytkownika.
Handoff Slice 1 i `.codex/config.toml` nie były modyfikowane w Slice 2.

## Werdykt i handoff

**PASS dla lokalnego Slice 2.** Review gate Slice 1, końcowe testy,
typecheck/lint/build, rzeczywiste transakcje i RLS na Postgres 15/17 oraz
oba ukierunkowane smoke przeszły po opisanych poprawkach. Testy nie są
skipowane, a wcześniejsze niepowodzenia są jawnie opisane powyżej.
Brak znanego blokera dla tego lokalnego zakresu. Pełna suite E2E,
produkcja i ręczny przegląd wizualny nie zostały zadeklarowane jako PASS.

Kontynuacja: najpierw przeczytać aktualny Git/diff, oba handoffy i runbook
0028. Zakres następnego promptu: wyłącznie Presence według planu powyżej.
Zmiany obu slice'ów oraz migracja nadal są bez commita. Nowy kanał wymaga
0028 w docelowym środowisku; zastosowanie poza izolowanymi testami wymaga
osobnej autoryzacji. Zachować `.codex/config.toml`, nie resetować worktree,
nie wykonywać rebrandingu ani remote mutations w ramach tej kontynuacji.
