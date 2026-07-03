# Poza Nutą — kompletna roadmapa dojścia do wersji produkcyjnej

**Cel dokumentu:** opisać, do czego dążymy, jaką architekturę utrzymujemy, w jakiej kolejności kończymy projekt i dlaczego właśnie tak.  
**Stan bazowy:** po rozmowie i ostatnich commitach projekt ma już Next.js `src/app`, Supabase Auth, Drizzle/Postgres, dashboard shadcn/ui, backend i UI dla event access links.  
**Zasada nadrzędna:** nie dokładamy funkcji losowo. Każdy krok ma domykać konkretny fragment flow: operator → event → kolejka realtime → uczestnik → QR/session → role/operacje → rozliczenia.

---

## 0. Aktualne decyzje strategiczne: workspace, stały QR i event hosts

Te decyzje są nadrzędne wobec starszych notatek o event-specific QR i `/session/[code]`. Jeśli dalsza część roadmapy mówi inaczej, należy ją czytać jako historyczny etap wymagający dostosowania do poniższego modelu.

### Workspace / organizacja

- Poza Nutą ma działać jako workspace/organizacja, nawet jeśli MVP zaczyna od jednego workspace’u.
- Domyślny publiczny handle dla obecnej organizacji to `pozanuta`.
- Workspace ma members z rolami:
  - `owner` — pełne zarządzanie workspace’em, członkami, ustawieniami i rozliczeniami,
  - `manager` — zarządzanie eventami i konfiguracją operacyjną,
  - `operator` — obsługa kolejki i pracy eventu,
  - `viewer` — podgląd bez zmian.
- Operator może zarządzać kolejką, ale nie musi mieć prawa zmiany nazwy eventu ani event settings. Uprawnienia do queue i settings muszą być rozdzielone na poziomie API, nie tylko UI.

### Stały publiczny QR

- Główny drukowany QR dla Poza Nutą ma być stały i prowadzić do:

```txt
/join/pozanuta
```

- Trasa:

```txt
/join/{workspaceHandle}
```

rozwiązuje aktualny aktywny event danego workspace’u.

- Event-specific access links nie są głównym mechanizmem drukowanego QR.
- Access links mogą zostać jako mechanizm pomocniczy, awaryjny, promocyjny albo do kampanii/specjalnych wejść.
- Stały QR nie powinien wymagać ponownego drukowania przy każdym evencie.

### Event hosts / assignments

- Event ma hosts/assignments: jednego lub wielu prowadzących.
- Host eventu nie musi być ownerem workspace’u.
- Host/operator assignments powinny określać, kto prowadzi konkretny event, kto obsługuje kolejkę i kto może zmieniać ustawienia eventu.

### Realtime dashboard queue

- Realtime dashboard queue jest priorytetem produktu.
- Mechanizm ma być event-driven: Supabase Realtime Broadcast jako sygnał invalidacji + refetch przez nasze API.
- Nie używamy interval pollingu jako docelowego mechanizmu kolejki.

---

## 1. Docelowy produkt

Poza Nutą ma być aplikacją do obsługi karaoke/eventów, w której:

1. Operator loguje się do dashboardu.
2. Owner/admin zarządza operatorami, lokalami, eventami i uprawnieniami.
3. Operator tworzy lub wybiera event.
4. Dla eventu generuje link/QR dla uczestników.
5. Uczestnik przez kod/session zgłasza piosenkę.
6. Operator widzi kolejkę realtime.
7. Operator akceptuje, odrzuca, startuje, kończy, przestawia i porządkuje zgłoszenia.
8. System pilnuje czasu eventu, ostrzega przed końcem i pozwala przedłużyć.
9. System pokazuje źródło piosenki: KaraFun/iSing/inne.
10. Panel działa wygodnie na jasnym i ciemnym motywie.
11. Owner widzi użytkowników, role, lokale, eventy i podstawowe rozliczenia.
12. Operator może odbić wejście/wyjście i rozliczyć dzień pracy.

---

## 2. Zasady architektury, których nie łamiemy

### 2.1. Źródło prawdy

- Dane biznesowe idą przez **Next API + Drizzle + Postgres**.
- Browser nie czyta bezpośrednio tabel biznesowych Supabase.
- Supabase Auth służy do tożsamości i sesji dashboardu.
- Supabase Realtime ma służyć jako **sygnał invalidacji**, nie jako główne API danych.

### 2.2. Bezpieczeństwo

- Brak `service_role` w browserze.
- Publiczny uczestnik nie dostaje dashboardowego auth.
- Kod access linka nie jest trzymany w plaintext w DB.
- Raw code pokazujemy tylko raz po create.
- Revoke nie usuwa rekordu, tylko dezaktywuje.
- Publiczne requesty finalnie mają być bramkowane przez session/access code.
- Operacje destructive zawsze przez potwierdzenie, nie przez `window.confirm`.

### 2.3. UI

- shadcn/ui jest lokalnym code-owned foundation.
- Nie używamy gotowych dashboard blocks bez review.
- Nie mieszamy redesignu z logiką domenową.
- Sidebar/dark mode to osobny etap, nie dodatek przy okazji backendu.

### 2.4. Realtime

- Nie robimy interval pollingu jako docelowego mechanizmu kolejki.
- Nie robimy własnego WebSocket servera.
- Nie robimy SSE z Next/Vercel jako podstawy realtime.
- Docelowo: **Supabase Realtime Broadcast + refetch przez nasze API**.

---

## 3. Co jest już zrobione

### 3.1. Repo i architektura

- Legacy `apps/api`, `apps/web`, stare `src` usunięte.
- Aplikacja przeniesiona do `src/app`.
- Aktywne katalogi:
  - `src/app`
  - `src/components`
  - `src/server`
  - `src/db`
  - `src/lib`
  - `src/proxy.ts`
- Stare lokalne JSON/Vite/Node workflow odłączone.
- README/AGENTS zaktualizowane.

### 3.2. Dashboard/Auth

- Supabase Auth SSR.
- `/sign-in`.
- `/dashboard`.
- `/dashboard/queue`.
- `/dashboard/settings`.
- Dashboard chroniony przez Proxy.
- Google login sam z siebie nie daje dostępu; wymagane mapowanie w `operator_users`.

### 3.3. UI foundation

- shadcn/ui foundation dodany lokalnie.
- Dashboard shell zmigrowany na shadcn/ui.
- Brak importów z paczki `shadcn`.
- Brak `shadcn/tailwind.css`.
- Tailwind v4 działa lokalnie.

### 3.4. Event lifecycle

- Aktywny event.
- Manual close.
- Extend.
- Auto-close logic.
- Dashboard overview/settings.
- Kontrolowane dialogi zamiast `window.confirm`.

### 3.5. Public/API

- Public API:
  - event
  - song search
  - requests
  - queue
- Dashboard API:
  - queue
  - request transitions
  - event lifecycle
- KaraFun Postgres importer.
- Bezpieczne upserty.

### 3.6. Event access links

- Backend:
  - `event_access_links`
  - raw code tylko po create
  - hash w DB
  - revoke
- Dashboard UI:
  - create/list/revoke
  - raw code tylko w lokalnym stanie po create
- Migracja dev DB zastosowana.

---

## 4. Krytyczna ścieżka do MVP

To są kroki, które trzeba zrobić, żeby produkt miał sens operacyjny.

---

# ETAP 0 — aktualny sanity check

## Cel

Upewnić się, że obecny stan jest czysty i można kontynuować.

## Komendy

```bash
git status --short --untracked-files=all
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## Acceptance criteria

- Git status czysty.
- Testy przechodzą.
- Build przechodzi.
- Dev DB ma migrację `event_access_links`.

---

# ETAP 1 — authenticated smoke dashboardu i source badge w kolejce

## Dlaczego teraz

Dashboard został mocno przebudowany UI, ale zalogowany flow nie był w pełni sprawdzony. Dodatkowo operator musi widzieć, czy piosenka jest z KaraFun, iSing czy innego źródła.

## Co zrobić

1. Zalogować się do dashboardu lokalnymi env:
   - `SMOKE_OPERATOR_EMAIL`
   - `SMOKE_OPERATOR_PASSWORD`
2. Sprawdzić:
   - `/dashboard`
   - `/dashboard/queue`
   - `/dashboard/settings`
   - account menu
   - access links panel
   - close dialog tylko open/cancel
3. Sprawdzić, czy kolejka pokazuje source piosenki.
4. Jeśli nie:
   - dodać `Badge` source przy zgłoszeniu.
   - nie zmieniać DB, jeśli source już jest w payloadzie.
   - jeśli source nie ma w payloadzie, najpierw poprawić dashboard API.

## Acceptance criteria

- Login działa.
- Dashboard renderuje się po auth.
- `/dashboard/queue` pokazuje source label.
- Brak destructive mutation.
- Test/typecheck/lint/build przechodzą.

## Commit

```txt
fix: show song source in dashboard queue
```

---

# ETAP 2 — realtime kolejki bez pollingu

## Dlaczego teraz

Bez realtime dashboard operatora będzie zachowywał się jak martwy panel. To jest krytyczne dla karaoke, bo zgłoszenia i statusy muszą pojawiać się natychmiast albo prawie natychmiast.

## Decyzja architektoniczna

Robimy:

```txt
Supabase Realtime Broadcast
+
refetch przez nasze API
```

Nie robimy:

```txt
setInterval polling
SSE
własny WebSocket server
bezpośrednie czytanie tabel przez browser
```

## Co zrobić

1. Migracja Drizzle:
   - funkcja broadcastująca zmianę `song_requests`
   - trigger po `INSERT/UPDATE/DELETE`
   - minimalny payload:
     - `eventId`
     - `type: "queue_changed"`
     - `operation`
     - `changedAt`
2. Kanał:
   - np. `dashboard:event:{eventId}:queue`
3. Autoryzacja:
   - prywatny kanał, jeśli możliwe
   - RLS/policy dla realtime messages
   - tylko zalogowani operatorzy z dostępem do dashboardu
4. Hook klienta:
   - `useDashboardQueueRealtime(eventId, onInvalidate)`
   - subscribe/unsubscribe
   - refetch on event
   - refetch on reconnect/focus
   - brak interval pollingu
5. Operator queue:
   - po evencie robi refetch przez obecne dashboard API.
6. Testy:
   - helpery topic/payload
   - brak `setInterval`
   - brak Postgres direct reads w browserze.

## Acceptance criteria

- Zmiana kolejki powoduje odświeżenie UI.
- Dane kolejki nadal idą przez API.
- Realtime payload nie zawiera danych wrażliwych.
- Brak interval pollingu.
- Test/typecheck/lint/build przechodzą.
- Migracja nie jest aplikowana na produkcję bez osobnej zgody.

## Commit

```txt
feat: add realtime invalidation for dashboard queue
```

---

# ETAP 3 — routing eventowy dashboardu

## Dlaczego

`/dashboard/queue` jest MVP shortcutem, ale kolejka należy do konkretnego eventu. Dla jednego eventu aktywnego to przejdzie, ale architektonicznie będzie blokować:
- historię eventów,
- wiele lokali/sal,
- event-specific settings,
- rozliczenia per event,
- deep linki dashboardu.

## Docelowe trasy

```txt
/dashboard
/dashboard/events
/dashboard/events/new
/dashboard/events/[eventId]
/dashboard/events/[eventId]/queue
/dashboard/events/[eventId]/settings
/dashboard/events/[eventId]/access-links
```

Na MVP można zostawić redirect:

```txt
/dashboard/queue -> /dashboard/events/{activeEventId}/queue
/dashboard/settings -> /dashboard/events/{activeEventId}/settings
```

## Co zrobić

1. Dodać event-specific routes.
2. Przenieść obecne komponenty bez zmiany logiki.
3. Dodać helper resolve active event.
4. Stare trasy zrobić jako redirect do aktywnego eventu.
5. API docelowo też przygotować pod eventId:
   - `/api/dashboard/events/[eventId]/queue`
   - później compatibility wrappers.

## Acceptance criteria

- Obecny UX nadal działa.
- Nowe event-specific trasy działają.
- Stare trasy redirectują.
- Brak zmiany DB schema, jeśli niepotrzebna.
- Test/typecheck/lint/build przechodzą.

## Commit

```txt
refactor: route dashboard through event-specific pages
```

---

# ETAP 4 — model czasu eventu: od–do, default 6h, warning 10 min

## Dlaczego

Obecne 8h było technicznym placeholderem. Realny event powinien mieć harmonogram.

## Docelowa logika

- Operator ustawia start.
- Operator może ustawić end.
- Jeśli end nie podany:
  - domyślny czas = 6h.
- `autoCloseAt`:
  - jeśli end podany: `scheduledEndAt`
  - jeśli end niepodany: `startsAt + 6h`
- 10 minut przed końcem dashboard pokazuje warning.
- Operator może przedłużyć:
  - +15m
  - +30m
  - +60m
  - custom until

## DB

Prawdopodobne pola:

```txt
scheduled_start_at
scheduled_end_at nullable
auto_close_at
closed_at
```

Jeżeli obecne `startsAt/autoCloseAt` wystarczą, nie mnożyć pól. Ale trzeba jasno oddzielić:
- planowany start,
- planowany koniec,
- auto-close deadline,
- faktyczne zamknięcie.

## Co zrobić

1. Zmienić event start/create validation.
2. UI start event:
   - od kiedy
   - do kiedy opcjonalnie
3. Zmienić default auto-close z 8h na 6h.
4. Dashboard alert 10 min przed końcem.
5. Extend by duration/custom time.
6. Testy lifecycle.

## Acceptance criteria

- Event bez end kończy się po 6h.
- Event z end kończy się według end.
- Warning pojawia się 10 min przed końcem.
- Extend działa i audytuje akcję.
- Closing event nie mutuje statusów requestów.
- Test/typecheck/lint/build przechodzą.

## Commit

```txt
feat: add event scheduling and closing warning
```

---

# ETAP 5 — queue ordering i drag/drop

## Dlaczego

Operator musi móc zmieniać kolejność zgłoszeń intuicyjnie. Drag/drop ma sens dopiero po realtime, bo inaczej kilku operatorów może sobie nadpisywać stan.

## DB/API

Dodać pole:

```txt
queue_position
```

albo osobną logikę sortowania per event/status.

## Endpoint

```txt
POST /api/dashboard/events/[eventId]/queue/reorder
```

Payload najlepiej minimalny:

```json
{
  "orderedRequestIds": [12, 18, 5]
}
```

Serwer:
- waliduje, czy requesty należą do eventu,
- transakcyjnie zapisuje pozycje,
- emituje `queue_changed`.

## UI

- Drag/drop tylko w statusach, gdzie to ma sens.
- Nie mieszać accepted/now/done bez jasnej reguły.
- Po drop:
  - optimistic update opcjonalny,
  - server confirmation,
  - realtime invalidate.

## Acceptance criteria

- Operator może zmienić kolejność.
- Reorder jest transakcyjny.
- Reorder nie gubi statusów.
- Realtime odświeża inne dashboardy.
- Test/typecheck/lint/build przechodzą.

## Commit

```txt
feat: add dashboard queue reorder
```

---

# ETAP 6 — public session route `/session/[code]`

## Aktualizacja decyzji

Ten etap wymaga przeprojektowania pod stały workspace QR. Docelowa publiczna ścieżka wejścia uczestnika to:

```txt
/join/{workspaceHandle}
```

Dla Poza Nutą główny drukowany QR prowadzi do:

```txt
/join/pozanuta
```

`/join/{workspaceHandle}` rozwiązuje aktualny aktywny event workspace’u i dopiero potem tworzy albo odnawia participant session. Event-specific access links mogą pozostać jako mechanizm pomocniczy/awaryjny/promocyjny, ale nie są głównym mechanizmem drukowanego QR.

## Dlaczego

Access links/QR bez session flow są tylko połową funkcji. Uczestnik musi wejść przez kod, dostać sesję i dopiero wtedy móc zgłaszać.

## Docelowy flow

1. Operator tworzy access link.
2. System pokazuje `/session/{code}` i QR.
3. Uczestnik otwiera `/session/{code}`.
4. Serwer hashuje code i szuka aktywnego linku.
5. Jeśli link aktywny:
   - tworzy participant session,
   - ustawia HttpOnly cookie,
   - zwiększa `use_count`,
   - ustawia `last_used_at`,
   - redirectuje do request page.
6. Jeśli link revoked/invalid:
   - pokazuje błąd.
   - nie redirectuje do nowego kodu.

## DB

Prawdopodobnie nowa tabela:

```txt
participant_sessions
- id
- event_id
- access_link_id
- session_token_hash
- created_at
- expires_at
- last_seen_at
- revoked_at nullable
```

## Acceptance criteria

- Raw code nie jest zapisywany.
- Cookie HttpOnly.
- Invalid/revoked code nie działa.
- Stary kod nie dostaje automatycznego redirectu do nowego.
- Public request wymaga session.
- Test/typecheck/lint/build przechodzą.

## Commit

```txt
feat: add public event session route
```

---

# ETAP 7 — QR rendering

## Aktualizacja decyzji

Priorytetem QR jest stały publiczny QR workspace’u, a nie QR generowany per event access link. Dla obecnego workspace’u drukowany QR powinien zawierać pełny URL do `/join/pozanuta`.

Access-link QR może zostać jako opcjonalny widok po create, ale jest pomocniczy: awaryjny, promocyjny albo kampanijny. Nie powinien być opisany jako główny mechanizm obsługi standardowego eventu.

## Dlaczego

QR ma sens dopiero, gdy `/session/[code]` rzeczywiście działa. Można go pokazywać wcześniej po create, ale produktowo warto domknąć session route.

## UI

W access links panelu po create:
- raw code,
- session URL,
- QR,
- komunikat: widoczne tylko teraz.

Po refreshu:
- raw code znika,
- QR znika,
- lista pokazuje tylko metadata.

## Acceptance criteria

- QR tylko po create.
- QR zawiera pełny URL do `/session/{code}`.
- Raw code nie jest persistowany.
- Brak localStorage/sessionStorage.
- Test/typecheck/lint/build przechodzą.

## Commit

```txt
feat: add QR rendering for event access links
```

---

# ETAP 8 — bramkowanie public request flow przez session

## Dlaczego

Obecnie publiczny request flow jest zbyt otwarty. Docelowo uczestnik ma przejść przez access link/session.

## Co zrobić

1. Public request page sprawdza participant session cookie.
2. API `/api/public/requests` wymaga ważnej session.
3. Public queue może być:
   - publiczna bez session,
   - albo zależna od event setting.
4. Search może być:
   - dostępny po session,
   - albo publiczny według ustawienia.
5. Brak session:
   - redirect do `/`
   - albo komunikat „zeskanuj QR”.

## Acceptance criteria

- Nie można zgłosić piosenki bez session.
- Session jest powiązana z eventem.
- Revoke access link nie musi zabijać już istniejących session, chyba że zdecydujemy inaczej.
- Test/typecheck/lint/build przechodzą.

## Commit

```txt
feat: require participant session for song requests
```

---

# ETAP 9 — event list, public pages i Facebook redirect

## Aktualizacja decyzji

Publiczny routing musi uwzględniać workspace join:

```txt
/join/{workspaceHandle} -> aktualny aktywny event workspace’u
```

Dla Poza Nutą:

```txt
/join/pozanuta
```

Event identity, workspace identity i access-code identity nie są tym samym. Access links nie powinny zastępować stałego join route.

## Decyzje z rozmowy

Docelowo:

```txt
/               -> lista eventów albo landing
/join/pozanuta  -> stały publiczny QR Poza Nutą
/join/{workspaceHandle} -> aktywny event workspace’u
/events/[slug]  -> redirect do Facebook URL
/session/[code] -> legacy/pomocniczy event access link, jeśli zostaje
/queue          -> public active queue
```

## Co zrobić

1. Event ma `slug`.
2. Event może mieć `facebookUrl`.
3. `/events/[slug]` redirectuje do Facebook URL.
4. `/` pokazuje event list lub landing.
5. Nie mylić event identity z access code.

## Acceptance criteria

- Event slug działa.
- Facebook redirect działa.
- `/join/{workspaceHandle}` rozwiązuje aktywny event workspace’u.
- `/session/[code]`, jeśli zostaje, jest pomocniczym access-link flow, a nie głównym drukowanym QR.
- Stary/revoked code nie redirectuje do nowego.
- Test/typecheck/lint/build przechodzą.

## Commit

```txt
feat: add public event listing and facebook redirects
```

---

# ETAP 10 — role i owner/admin panel

## Dlaczego

Bez owner panelu nie da się zarządzać operatorami i dostępem. To jest wymagane przed większym użyciem produkcyjnym.

## Role początkowe

```txt
owner
manager
operator
viewer
```

To są role workspace members. Starsze nazwy `event_manager` i `queue_operator` należy traktować jako robocze odpowiedniki `manager` i `operator`, nie jako docelowy słownik ról.

## Uprawnienia

### owner

- zarządza użytkownikami,
- zarządza lokalami,
- tworzy eventy,
- wszystko w kolejce,
- rozliczenia.

### manager

- tworzy/edytuje eventy,
- access links,
- venue selection.

### operator

- obsługuje kolejkę.
- nie musi mieć prawa zmiany nazwy eventu ani event settings.
- może być przypisany jako host/prowadzący konkretnego eventu.

### viewer

- tylko podgląd.

## Event hosts / assignments

Event powinien mieć assignments/hosts:

```txt
event_hosts
- event_id
- workspace_member_id / operator_user_id
- assignment_role
```

Jeden event może mieć jednego albo wielu prowadzących. Host/prowadzący może zarządzać kolejką dla przypisanego eventu, ale prawo do zmiany konfiguracji eventu powinno być osobnym uprawnieniem.

## Co zrobić

1. Uporządkować `operator_users`.
2. Dodać policy checks per endpoint.
3. `/dashboard/admin/users`.
4. Invite/create operator mapping.
5. Aktywacja/dezaktywacja operatora.
6. Dodać model workspace members.
7. Dodać event hosts/assignments.
8. Rozdzielić uprawnienia queue management od event settings.
9. Testy RBAC.

## Acceptance criteria

- Google/Auth user bez operator record nadal nie ma dostępu.
- Owner może dodać operatora.
- Role ograniczają API, nie tylko UI.
- Test/typecheck/lint/build przechodzą.

## Commit

```txt
feat: add operator role management
```

---

# ETAP 11 — account settings i Google linking

## Dlaczego

Operator musi móc zarządzać swoim profilem i logowaniem.

## Zakres

```txt
/dashboard/account
```

Funkcje:
- imię,
- nazwisko,
- display name,
- email,
- hasło,
- połączenie z Google,
- logout wszystkich sesji opcjonalnie.

## Ważne

Email/hasło/Google to Supabase Auth. Nie robić własnego systemu haseł dla dashboardu.

## Acceptance criteria

- Profil lokalny i Supabase Auth nie rozjeżdżają się.
- Brak możliwości eskalacji roli przez account settings.
- Test/typecheck/lint/build przechodzą.

## Commit

```txt
feat: add operator account settings
```

---

# ETAP 12 — venues/lokale jako słownik

## Dlaczego

Lokal nie powinien być tylko free text. Operator powinien wybierać z listy, ale owner/admin może dodać nowy.

## DB

```txt
venues
- id
- name
- address nullable
- active
- created_at
- updated_at
```

Event:
```txt
venue_id nullable
```

Na migracji można zachować stare `venue` jako legacy text albo zrobić migrację danych.

## UI

```txt
/dashboard/venues
```

W event form:
- select venue,
- create new inline albo link do venues,
- deactivate venue, nie hard delete.

## Acceptance criteria

- Event może mieć venue z listy.
- Owner może dodać/dezaktywować venue.
- Stare eventy bez venue nie wybuchają.
- Test/typecheck/lint/build przechodzą.

## Commit

```txt
feat: add venue management
```

---

# ETAP 13 — dashboard sidebar i light/dark mode

## Dlaczego

Dopiero teraz, bo wcześniej priorytetem była logika event/queue/session. Sidebar ma sens, gdy są już sekcje: events, queue, account, users, venues, shifts.

## Zakres

- Sidebar shell.
- Nawigacja:
  - Dashboard
  - Events
  - Queue
  - Access Links
  - Venues
  - Users
  - Account
  - Shifts/Payments
- Light/dark toggle.
- Persistencja preferencji:
  - local storage albo cookie.
- Dostępność:
  - keyboard navigation,
  - focus states,
  - aria labels.

## Acceptance criteria

- Dashboard działa mobile/desktop.
- Dark/light nie rozwala public UI.
- Brak gotowych sidebar blocks bez review.
- Test/typecheck/lint/build przechodzą.

## Commit

```txt
refactor: add dashboard sidebar and theme toggle
```

---

# ETAP 14 — shifts i rozliczenia operatora

## Dlaczego

To jest wartościowe biznesowo, ale nie jest core karaoke queue. Dlatego dopiero po event/session/realtime/RBAC.

## DB

```txt
operator_shifts
- id
- operator_user_id
- event_id nullable
- venue_id nullable
- clock_in_at
- clock_out_at nullable
- hourly_rate
- expected_amount
- paid_amount nullable
- paid_at nullable
- payment_status
- notes nullable
```

## Funkcje

- Operator clock in.
- Operator clock out.
- System liczy czas.
- System liczy expected amount.
- Owner oznacza paid/unpaid.
- Raport per dzień/event/operator.

## Acceptance criteria

- Nie da się mieć dwóch otwartych shiftów dla operatora.
- Kwoty są liczone deterministycznie.
- Owner widzi status płatności.
- Test/typecheck/lint/build przechodzą.

## Commit

```txt
feat: add operator shifts and payments
```

---

# ETAP 15 — importy i katalog piosenek jako produkt

## Dlaczego

Import KaraFun działa lokalnie, ale docelowo operator/owner powinien mieć kontrolę w dashboardzie albo przynajmniej job/status.

## Zakres

- Import jobs w dashboardzie.
- Status importu.
- Error report.
- Historia importów.
- iSing importer, jeśli dalej potrzebny.
- Nie kasować katalogu podczas eventu.
- Upsert po `(source, source_song_id)`.

## Acceptance criteria

- Import nie psuje aktywnego eventu.
- Błąd importu nie wywala katalogu.
- Brak truncate/delete songs w runtime.
- Test/typecheck/lint/build przechodzą.

## Commit

```txt
feat: add catalog import jobs
```

---

# ETAP 16 — observability, bezpieczeństwo, operacje

## Zakres

1. Rate limiting public endpoints.
2. Basic abuse protection.
3. Audit log dla:
   - event close,
   - access link create/revoke,
   - queue transitions,
   - user role changes.
4. Error boundaries.
5. Sensowne loggingi bez sekretów.
6. Sentry opcjonalnie.
7. Backup/restore procedura Supabase.
8. Security review env variables.
9. Secret scanning.
10. CSP/security headers.

## Acceptance criteria

- Public request API nie jest łatwe do spamowania.
- Operator actions są audytowane.
- Nie logujemy haseł, raw codes, tokenów.
- Test/typecheck/lint/build przechodzą.

## Commit

```txt
chore: harden production operations
```

---

# ETAP 17 — produkcyjny deploy

## Checklist

1. Vercel project.
2. Supabase project.
3. Env vars:
   - DB URL,
   - Supabase URL,
   - anon key,
   - auth config,
   - site URL,
   - Google OAuth.
4. Migrations applied.
5. Seed owner/operator.
6. Link operator to Supabase Auth.
7. Domain.
8. HTTPS.
9. Redirect URLs w Supabase Auth.
10. Smoke:
    - `/sign-in`
    - login
    - dashboard
    - create event
    - create access link
    - QR/session
    - participant request
    - realtime queue
    - close event.

## Acceptance criteria

- Production smoke pass.
- Rollback plan istnieje.
- Backup plan istnieje.
- Nie ma lokalnych sekretów w repo.

## Commit

Tu zwykle może nie być commita, ale może być:

```txt
docs: add production deployment checklist
```

---

# ETAP 18 — finalne E2E i release candidate

## Testy E2E

Scenariusze:

1. Owner tworzy operatora.
2. Operator loguje się.
3. Operator tworzy event.
4. Operator generuje access link.
5. Uczestnik wchodzi przez QR/session.
6. Uczestnik szuka piosenki.
7. Uczestnik zgłasza piosenkę.
8. Dashboard queue realtime pokazuje zgłoszenie.
9. Operator akceptuje.
10. Operator zmienia kolejność.
11. Operator startuje piosenkę.
12. Operator kończy piosenkę.
13. Event ostrzega przed końcem.
14. Operator przedłuża event.
15. Operator zamyka event.
16. Owner widzi rozliczenie.

## Acceptance criteria

- Pełny flow działa bez ręcznego grzebania w DB.
- E2E nie wykonuje destructive production actions.
- Test/typecheck/lint/build przechodzą.
- Smoke produkcyjny pass.

---

## 5. Priorytetyzacja

### P0 — bez tego produkt nie działa normalnie

1. Authenticated smoke.
2. Source badge w queue.
3. Realtime queue.
4. Event-specific routing.
5. Event schedule/end/warning.
6. Participant session.
7. Public request gating.

### P1 — potrzebne do sensownego używania

1. QR.
2. Drag/drop reorder.
3. Owner/user roles.
4. Venues.
5. Account settings.
6. Sidebar/dark mode.

### P2 — biznes i operacje

1. Shifts/payments.
2. Import jobs UI.
3. Observability.
4. Advanced analytics.
5. Reports.

---

## 6. Decyzje, które trzeba podjąć

Te pytania nie blokują najbliższego realtime/source badge, ale blokują dalszy model domeny.

1. Czy aplikacja ma obsługiwać więcej niż jeden aktywny event naraz?
2. Czy może być wiele lokali/sal w tym samym czasie?
3. Czy operator może pracować dla wielu lokali?
4. Czy role `owner`, `event_manager`, `queue_operator`, `viewer` wystarczą?
5. Czy rozliczenia są per operator, per event, per lokal, czy mieszane?
6. Czy stawka godzinowa jest stała dla operatora, czy per event/lokal?
7. Czy publiczne zgłoszenie ma zawsze wymagać session code?
8. Czy publiczna kolejka `/queue` ma być dostępna bez kodu?
9. Czy Google login ma być obowiązkowy, czy tylko dodatkowy?
10. Czy eventy mają mieć publiczne strony, czy tylko Facebook redirect?
11. Czy po revoke access linka istniejące participant sessions mają dalej działać?
12. Czy source piosenki ma być tylko etykietą, czy ma wpływać na zachowanie kolejki?
13. Czy drag/drop może zmieniać kolejność tylko approved, czy także pending?
14. Czy operator może edytować zgłoszenie uczestnika?
15. Czy uczestnik może zgłosić więcej niż jedną piosenkę naraz?

---

## 7. Najbliższy konkretny plan pracy

### Krok następny

```txt
Authenticated smoke + source badge
```

### Potem

```txt
Realtime queue via Supabase Broadcast
```

### Potem

```txt
Event-specific routing
```

### Potem

```txt
Event scheduling: start/end/default 6h/warning 10m
```

### Potem

```txt
Participant session + request gating
```

---

## 8. Czego nie robić teraz

Nie robić teraz:

- sidebar,
- dark mode,
- shifts/payments,
- owner panel,
- venues,
- QR,
- drag/drop,

dopóki realtime i event/session model nie są domknięte.

Powód: inaczej upiększymy panel, który nadal nie ma stabilnego core flow.

---

## 9. Definicja „projekt skończony”

Projekt można uznać za skończony na poziomie MVP, jeśli:

1. Owner może założyć operatora.
2. Operator może się zalogować.
3. Operator może stworzyć event z godzinami.
4. Operator może wygenerować QR/session access.
5. Uczestnik może wejść przez QR.
6. Uczestnik może wyszukać i zgłosić piosenkę.
7. Dashboard operatora widzi zgłoszenie realtime.
8. Operator może zarządzać kolejką.
9. Operator widzi source piosenki.
10. Operator może zmienić kolejność kolejki.
11. Event ostrzega przed końcem.
12. Operator może przedłużyć lub zamknąć event.
13. Owner może zarządzać użytkownikami i lokalami.
14. Podstawowe role działają na API, nie tylko w UI.
15. Produkcyjny deploy działa.
16. Testy i smoke przechodzą.
17. Nie ma sekretów w repo.
18. Publiczne zgłoszenia są zabezpieczone session/access code.

---

## 10. Najkrótsza wersja kolejności

```txt
1. Authenticated smoke dashboardu
2. Source badge w queue
3. Realtime queue bez pollingu
4. Event-specific routing
5. Event schedule od–do, default 6h, warning 10m
6. Participant session /session/[code]
7. Gate public requests by session
8. QR rendering
9. Queue reorder drag/drop
10. Owner/user roles
11. Account settings + Google linking
12. Venue management
13. Sidebar + dark/light
14. Shifts/payments
15. Import jobs dashboard
16. Production hardening
17. Deploy + E2E
```
