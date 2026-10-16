# Foundation checkpoint: Participant Model & Fair Queue, Slice 1–5

Data: 2026-10-16. Werdykt: **READY FOR APPROVAL** dla lokalnego checkpointu.
Nie jest to zgoda na wdrożenie ani potwierdzenie stanu produkcji.

Przygotowano jeden spójny checkpoint: **127 staged plików** (57 wcześniej
wersjonowanych i 70 nowych, w tym ten raport). Jedyna niezastage'owana zmiana
wersjonowanego pliku to prywatny `.codex/config.toml` użytkownika. Nie wykonano
commita, zmiany gałęzi, push, PR, deploy, produkcyjnej migracji, rebrandingu,
Enterprise DnD ani i18n. W tym zadaniu dodano ten raport i wąską regułę formatu patcha w
`.gitattributes` oraz przygotowano lokalny indeks Git; istniejący kod, testy, migracje i konfigurację zachowano bajtowo.

## Tożsamość repozytorium i kontrakt audytu

- Checkout: `C:/Projects/pozanuta-stage-1`, istniejący managed worktree.
- Branch: `fix/song-details-drawer-desktop-position`.
- HEAD: `9d1fd059c33c28d5679d4ba40037c3897285bb9d`.
- Origin fetch/push: `https://github.com/3SM-Studio/poza-nuta.git`.
- Istnieją też remotes `legacy-origin` (VictorAsvira) i `old-origin`
  (michal-szwindowski). Nie zmieniano ich i nie wykonywano fetch.
- Pozostałe worktree: pozanuta, pozanuta-clean, pozanuta-docs,
  pozanuta-public-session-ui. Nie modyfikowano ich ani pozanuta-social.
- Stan wejściowy: indeks pusty, 126 zmienionych/untracked plików:
  58 tracked modifications i 68 nowych. Po dodaniu raportu i .gitattributes: 128 zmian,
  z czego 127 należy do przygotowanego checkpointu, a jedna jest wykluczona.
- Personal `codex-prompt-strategist` i cztery referencje odczytano read-only
  z pozanuta-social. Zastosowano AGENTS.md oraz skille architektury, backendu,
  migracji, PostgreSQL, Supabase, security, testing i ops; dodatkowo auditor
  w trybie scoped release/health. Brak projektowego Git workflow SKILL.md;
  nie wymyślano takiego pliku, użyto jawnych reguł Git z zadania/AGENTS.md.
- Audit wykonano sekwencyjnie, bez agentów. Niezależne lokalne kontrole mogły
  działać równolegle; test → typecheck → lint → build → diff uruchomiono kolejno.
- Źródła prawdy: aktualny kod/diff, src/app, Drizzle schema/migrations,
  zaakceptowane ADR Presence/linking/fair-queue, runbooki 0028–0030 i handoffy.
  Dawne plany kolejnych slice'ów w handoffach są historią, nie bieżącym statusem.

## Werdykt fundamentów i przebieg krytyczny

| Etap | Werdykt lokalny | Zweryfikowany kontrakt i dowód |
| --- | --- | --- |
| Slice 1 — 2/2 | PASS | Wspólne pending/approved/now, limit eventId + canonical eventParticipantId. Public/operator create i inactive→active pod jednym queue mutexem; fresh PG + Node/Vitest, historyczny browser 2/2. |
| Slice 2 — Participant Management | PASS | Jedna identity/membership, ręczny profil bez credential, katalogowe songId, actor z sesji serwera, historia po ID, viewer read-only, canCancel tylko własny public pending. Fresh negative RBAC/scope/audit i RLS. |
| Slice 3 — Presence/PG17 | PASS | Lease UUID/karta, heartbeat 15 s, TTL 40 s według DB, tombstone, agregacja ważnych credentials, oddzielne locks, deadline snapshot zamiast list pollingu, RLS deny-all. PG17 obowiązuje we wszystkich aktywnych harnessach. |
| Slice 4 — linking/merge | PASS | Jednorazowe hashowane invitation + HttpOnly challenge, świadome approval/finish, receipt retry bez kolejnego credential; event-scoped canonical alias, dwie zgody, zachowane requesty i Presence. Fresh replay/expiry/races/rollback/scope. |
| Slice 4 Recovery — driver | PASS | Wersjonowany patch postgres@3.4.9, pin + pnpm patch hash, clean install i identyczne 37 plików pakietu. 22/22 fresh clean ESM/CJS fault workers oraz merge fault child w pełnej bramce. |
| Slice 5 — Fair Queue | PASS | Czysty deterministyczny engine, Fair Insert zachowuje wszystkie stare pary, jawny Fair Sort preview/revision/apply, now nieruchome, canonical response i stale GET guard; fresh 18 math w 391 Node, 14 PG w pełnej bramce. |
| Slice 5 Recovery — 0027 | PASS | Oddzielny historyczny fixture odmowy active legacy oraz runtime po pełnych migracjach. Exact 55000, integralność danych/schema, valid migration history; fresh guest 2/2 + 0027 9/9. |

Prześledzono join/credential → canonical membership → public/operator request →
2/2 i duplicate guards → approve/Fair Insert → manual move → Fair preview/apply →
start/done/restore; osobno Presence i linking/merge. Route handlers pozostają
adapterami, biznes i transakcje są w src/server, dane przez Drizzle/API.
Supabase Auth daje identity operatora; lokalne memberships decydują o RBAC.
Browser nie czyta business tables i nie przechowuje credential w storage.
Realtime pozostaje minimalną prywatną invalidacją, nie źródłem danych.

Fair Queue zachowuje `round=max(0, completed+allocatedNow-waitCredit)+ordinal`.
Rundy, tie-breakery, soft adjacency i ograniczenia ręcznej kolejności opisuje
zaakceptowany ADR. Brak audytu legacy daje deterministyczny creation tie i zero
retroaktywnego waitCredit; udana fairness mutation dopisuje observation anchor
w tej samej transakcji. Restore odejmuje obecne done; merge nie kopiuje historii.
Nie zmieniano tych decyzji domenowych w audycie.

## Świeża weryfikacja checkpointu

Logi lokalne są w ignorowanym `.artifacts/`; nie są częścią stagingu.

| Polecenie / zakres | Wynik świeży | Dowód |
| --- | --- | --- |
| pnpm test | PASS: Node 391/391, Vitest 597/597, 53 pliki, bez skipów | foundation-test.log |
| pnpm typecheck | PASS | foundation-typecheck.log |
| pnpm lint | PASS | foundation-lint.log |
| pnpm build | PASS: Next 16.3.0, TypeScript i static generation ukończone | foundation-build.log |
| git diff --check | PASS | foundation-diff-check.log |
| pnpm test:postgres:public-event-session-identity | PASS 47/47, 5 plików, 185,22 s | foundation-postgres.log |
| pnpm test:postgres:session-code-6-digits | PASS 9/9, 7,90 s | foundation-migration0027.log |
| pnpm test:postgres:guest-session-queue | PASS 2/2, 10,86 s | foundation-guest.log |
| pnpm test:postgres:db-contention | PASS 4/4, 20,89 s | foundation-contention.log |
| pnpm test:postgres:db-timeouts | PASS 3/3, 17,40 s | foundation-timeouts.log |
| Clean pnpm install --frozen-lockfile --store-dir .foundation-store | PASS: 668 packages, reused=0, 1m18,8 s, pnpm 11.7.0 | foundation-clean-install.log |
| Clean vitest: postgresDriverFault.integration.test.ts | PASS 22/22, 12,56 s | foundation-clean-driver.log |
| Clean drizzle-kit check | PASS | foundation-drizzle-check.log |
| Clean drizzle-kit generate --name foundation-verification | PASS, No schema changes, nothing to migrate | foundation-schema-drift.log |
| git diff --cached --check i pełny index/content review | PASS; dokładne 127 ścieżek, bez private config i artefaktów | foundation-cached-check.log, foundation-index-review.json |

Testy DB uruchamiano wyłącznie na disposable Docker PostgreSQL 17, losowy
credential per harness i loopback. Bramka obejmuje wszystkie 10 wyścigów
Fair Queue, atomowy rollback, spójność pozycji/now, stale preview, scope/RBAC,
2/2, RLS, linking/merge oraz twarde awarie sterownika. Clean driver suite używa
nowo odtworzonego node_modules; nie istniejącego pakietu z worktree.

### Dowód browser: HISTORYCZNY, nie świeży run

Dopuszczony przez zadanie wcześniejszy pełny run:
`slice5-recovery-browser-pass.log`, 2026-10-16, 10/10 PASS w jednym przebiegu,
PostgreSQL 170006; real Realtime Fair Sort 427 ms. Obejmuje desktop/mobile,
manual pointer + keyboard DnD, Fair Insert, preview/cancel/apply/stale/network
retry, public reorder bez odświeżania, start/done, participant management,
Presence TTL/tabs/reconnect, linking/claim/merge, 2/2, discovery/catalog i lifecycle.

Sprawdzono hashe 66 plików kodu produkcyjnego, migracji i zależności względem
baseline Recovery: wszystkie identyczne. Bieżące źródło E2E jest starsze niż
początek końcowego runu; jego ostatnie poprawki są zapisane w handoffie Slice 5
oraz w historii tej pracy. Audit nie zmienił żadnego pliku kodu/testów.
Nie przedstawiamy historycznego E2E ani Next DevTools jako świeżego uruchomienia.
Nie powtarzano 6,6-minutowego smoke bez zmiany kodu. Pełne niezwiązane z tym
fundamentem import/load suites i produkcyjny smoke są NOT RUN/OUT OF SCOPE.

## Integralność migracji i odtwarzalność zależności

- Wszystkie **28 starych plików SQL 0000–0027** są bajtowo zgodne z HEAD.
  Dotychczasowy prefix journal pozostał identyczny. Szczególnie 0027 nie
  zmienia guarda active/scheduled, remediation ani rollback contractu.
- Journal ma 31 wpisów, idx 0..30 i ściśle rosnące when. Snapshot chain
  0027→0028→0029→0030 ma poprawne prevId, bez luk lub konfliktu.
- 0028 zachowuje snapshot biznesowy 0027; dodaje prywatne funkcje/politykę/
  trigger invalidacji. Pusty search_path, minimalny payload, SELECT tylko
  dla właściwego aktywnego operatora/member organizacji.
- 0029 dodaje participant_connections, indeksy/FK/check/RLS i credential
  invalidation. 0030 dodaje dwie prywatne tabele i nullable alias columns/FK.
  Brak backfillu zgadywanego po nickach i brak kasowania historii.
- Nowe SQL nie zawiera przypadkowego DELETE/TRUNCATE/DROP/reset danych;
  ON DELETE w FK opisuje relację, nie jest wykonaniem usuwania. Bounded cleanup
  w serwisie Presence dotyczy wyłącznie efemerycznych lease starszych niż 24 h,
  zgodnie z ADR/runbookiem. Merge zachowuje identity, credentials i requests.
- RLS deny-all token/proposal/lease tables, brak client EXECUTE trigger functions.
  Fresh PG sprawdza faktyczne odmowy, a nie jedynie tekst SQL.
- Runbooki 0028–0030 mają preflight, zapytania odczytowe, lock/statement limits
  i rollback/forward-fix. Kod wymaga pełnego schema do 0030. Po wykonanym merge
  stary kod bez aliasów nie jest bezpiecznym rollbackiem.
- Drizzle check/generate wykonano w kopii poza worktree. Nie wygenerowano
  nowej migracji i nie edytowano schematu oryginalnego checkout.
- Patch zmienia tylko connection.js/index.js wariantów ESM/CJS/workerd.
  Clean frozen install z nowym store pobrał paczki bez reuse; wszystkie 37
  plików postgres są identyczne z działającym worktree, nie tylko marker patcha.
  Manifest, workspace i lockfile również pozostały zgodne. Brak zależności od
  ręcznego edytowania node_modules. ESM/CJS mają fresh runtime fault coverage;
  workerd ma zgodne zmiany statyczne, runtime workerd/PgBouncer OUT OF SCOPE.

## Sekrety, artefakty i ochrona pracy

Przeskanowano pełne treści 125 kandydatów przed stagingiem, nazwy, symlinki,
provider/JWT/private-key signatures i credential URLs, następnie zweryfikowano
rzeczywiste index blobs. Brak potwierdzonych sekretów lub podejrzanych nazw.
12 trafień URL to interpolacja losowego hasła własnego disposable Docker
harnessu, nie wpisane na stałe dane dostępowe. Wartości były redagowane.
Testowe UUID/hashe snapshotów nie są credentials produkcji.

To heurystyczna kontrola proponowanego checkpointu, nie pełny skan historii
Git, pentest OS lub zapewnienie braku dowolnej podatności. Nie inspekcjonowano ani nie wyświetlano wartości env, Auth storage/cookies
ani prywatnej konfiguracji; standardowy build może wczytać lokalne env bez
ich modyfikacji. Nie stage'owano
trace, logów, kopii baz, archiwów, .env, node_modules ani lokalnego stanu usług.
`.codex/config.toml` jest już tracked w HEAD: jego **prywatna delta** pozostaje
wyłącznie w worktree, a index zachowuje wersję HEAD. Nie usuwano go z historii.

Kopie odtworzeniowe:

- Zachowana wcześniejsza: `C:/Users/michas/AppData/Local/Temp/pozanuta-slice5-baseline-jsffgk85/worktree.zip`, 114 plików SHA-256.
- Dodatkowa wejściowa: `C:/Users/michas/AppData/Local/Temp/pozanuta-foundation-checkpoint-ygsmi_r5/worktree-changes.zip`, 125 plików, bez config.
- Trwała kopia finalnego checkpointu: `C:/Users/michas/.codex/backups/pozanuta-foundation-20261016-9rr9827z`; ZIP 127 plików, manifest SHA-256, metadata Git, binary diff i zestaw dowodów. Odtworzenie do osobnego katalogu zweryfikowano względem manifestu.
- Czysta instalacja: `C:/Users/michas/AppData/Local/Temp/pozanuta-foundation-install-dn2embdu`, bez .env i prywatnego config, nowy node_modules/store. Nie usuwano wcześniejszych kopii ani zastanych plików.

## Plan Git i granica zatwierdzenia

Rekomendowana nowa gałąź:
`michal-szwindowski/participant-model-fair-queue-foundation`.
Nie utworzono jej w tym zadaniu: pozostawiono dokładnie ten sam branch/HEAD
oraz zawartość worktree. Po akceptacji można utworzyć ją z obecnego HEAD bez
przenoszenia/stashowania zmian. Nie używano reset, clean, stash ani force push.

Rekomendowany **jeden atomowy commit fundamentów**, zamiast sztucznego podziału
na pięć: te same service.ts, event-queue.ts, schema/journal, wspólny resolver,
API contracts i E2E zawierają zależności kilku etapów. Dzielenie wymagałoby
rekonstrukcji wcześniejszych stanów, mogłoby zerwać migracje i odtworzenie
patchowanej zależności. Jeden commit utrzymuje kompilujący się, przetestowany
stan wraz z pełnymi ADR/runbookami i regresjami. To checkpoint, nie nowy feature.

Proponowany tytuł:
`feat: checkpoint participant model and fair queue foundation`

Proponowany opis: limit 2/2 i operator participant management; PostgreSQL 17
Presence; secure device linking i event-scoped identity merge; pnpm-versioned
Postgres.js fault recovery; deterministic Fair Insert i preview/apply Fair Sort;
addytywne migracje 0028–0030 oraz komplet regresji i handoffów.

Staging wykonano wyłącznie jawną listą ścieżek, z literal pathspec dla nazw
z nawiasami, po przeglądzie każdej klasy plików. Nie użyto git add -A.
Cały staged diff sprawdzono względem oczekiwanych plików i SHA-256; generated
snapshots dodatkowo przez semantic JSON delta i Drizzle no-drift. Ścieżki
importów/testów spoza participant mają wyłącznie wymagane PG17 lub additive
fixture updates; nie zawierają przypadkowego refaktoru importów.

### Dokładna lista staged i klasyfikacja

Legenda: S1 limit, S2 management, S3 Presence/PG17, S4 linking/merge,
S4 Recovery driver, S5 Fair Queue/Recovery. Wspólne oznaczenia wskazują pliki
nierozdzielone między etapami. M = istniejący plik, A = nowy plik.

| Stan | Plik | Zakres i rola |
| --- | --- | --- |
| A | `.gitattributes` | Foundation Git preparation: whitespace dla jednego unified-diff patcha |
| M | `.gitignore` | S3: Macierz PostgreSQL 17 / izolacja artefaktĂłw testowych |
| M | `README.md` | S3, S4, S5: Macierz PostgreSQL 17 / izolacja artefaktĂłw testowych |
| A | `docs/architecture/adr-fair-queue.md` | S5: ADR, handoff lub runbook |
| M | `docs/architecture/adr-import-job-execution.md` | S3: ADR, handoff lub runbook |
| A | `docs/architecture/adr-participant-linking.md` | S4: ADR, handoff lub runbook |
| A | `docs/architecture/adr-participant-presence.md` | S3: ADR, handoff lub runbook |
| A | `docs/features/participant-model-slice-1.md` | S1: ADR, handoff lub runbook |
| A | `docs/features/participant-model-slice-2.md` | S2: ADR, handoff lub runbook |
| A | `docs/features/participant-model-slice-3.md` | S3: ADR, handoff lub runbook |
| A | `docs/features/participant-model-slice-4.md` | S4: ADR, handoff lub runbook |
| A | `docs/features/participant-model-slice-5.md` | S5: ADR, handoff lub runbook |
| M | `docs/features/participant-song-discovery.md` | S3: ADR, handoff lub runbook |
| A | `docs/migrations/0028-event-participants-realtime.md` | S2: ADR, handoff lub runbook |
| A | `docs/migrations/0029-participant-presence.md` | S3: ADR, handoff lub runbook |
| A | `docs/migrations/0030-participant-linking.md` | S4: ADR, handoff lub runbook |
| A | `drizzle/0028_event_participants_realtime.sql` | S2: Migracja/snapshot/journal |
| A | `drizzle/0029_participant_presence.sql` | S3: Migracja/snapshot/journal |
| A | `drizzle/0030_participant_linking.sql` | S4: Migracja/snapshot/journal |
| A | `drizzle/meta/0028_snapshot.json` | S2: Migracja/snapshot/journal |
| A | `drizzle/meta/0029_snapshot.json` | S3: Migracja/snapshot/journal |
| A | `drizzle/meta/0030_snapshot.json` | S4: Migracja/snapshot/journal |
| M | `drizzle/meta/_journal.json` | S2, S3, S4: Migracja/snapshot/journal |
| M | `package.json` | S4 Recovery: Wersjonowanie i odtwarzalnoĹ›Ä‡ sterownika |
| A | `patches/README.md` | S4 Recovery: Wersjonowanie i odtwarzalnoĹ›Ä‡ sterownika |
| A | `patches/postgres@3.4.9.patch` | S4 Recovery: Wersjonowanie i odtwarzalnoĹ›Ä‡ sterownika |
| M | `pnpm-lock.yaml` | S4 Recovery: Wersjonowanie i odtwarzalnoĹ›Ä‡ sterownika |
| M | `pnpm-workspace.yaml` | S4 Recovery: Wersjonowanie i odtwarzalnoĹ›Ä‡ sterownika |
| A | `src/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/[participantId]/requests/route.ts` | S1, S2, S3, S4, S5: API/serwis uczestnictwa i kolejki |
| A | `src/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/[participantId]/route.ts` | S1, S2, S3, S4, S5: API/serwis uczestnictwa i kolejki |
| A | `src/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/merges/[proposalId]/route.ts` | S1, S2, S3, S4, S5: API/serwis uczestnictwa i kolejki |
| A | `src/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/merges/route.ts` | S1, S2, S3, S4, S5: API/serwis uczestnictwa i kolejki |
| A | `src/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/presence/route.ts` | S1, S2, S3, S4, S5: API/serwis uczestnictwa i kolejki |
| A | `src/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/route.ts` | S1, S2, S3, S4, S5: API/serwis uczestnictwa i kolejki |
| A | `src/app/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/songs/route.ts` | S1, S2, S3, S4, S5: API/serwis uczestnictwa i kolejki |
| A | `src/app/api/dashboard/organizations/[organizationId]/events/[eventId]/queue/fair/route.ts` | S1, S2, S3, S4, S5: API/serwis uczestnictwa i kolejki |
| A | `src/app/api/s/[token]/identity/linking/route.ts` | S1, S2, S3, S4, S5: API/serwis uczestnictwa i kolejki |
| A | `src/app/api/s/[token]/identity/merges/route.ts` | S1, S2, S3, S4, S5: API/serwis uczestnictwa i kolejki |
| A | `src/app/api/s/[token]/presence/route.ts` | S1, S2, S3, S4, S5: API/serwis uczestnictwa i kolejki |
| A | `src/app/dashboard/org/[organizationId]/events/[eventId]/participants/loading.tsx` | S2: UI, route lub wspĂłlny kontrakt |
| A | `src/app/dashboard/org/[organizationId]/events/[eventId]/participants/page.tsx` | S1, S2, S4: UI, route lub wspĂłlny kontrakt |
| M | `src/app/s/[token]/layout.tsx` | S3: UI, route lub wspĂłlny kontrakt |
| M | `src/components/operator/dashboard-shell.tsx` | S2: UI, route lub wspĂłlny kontrakt |
| A | `src/components/operator/event-participants-api.ts` | S2, S3: UI, route lub wspĂłlny kontrakt |
| A | `src/components/operator/event-participants-panel.tsx` | S2, S3, S4: UI, route lub wspĂłlny kontrakt |
| M | `src/components/operator/event-queue-api.ts` | S5: UI, route lub wspĂłlny kontrakt |
| M | `src/components/operator/event-queue-panel.tsx` | S1, S5: UI, route lub wspĂłlny kontrakt |
| A | `src/components/operator/fair-queue-control.tsx` | S5: UI, route lub wspĂłlny kontrakt |
| M | `src/components/operator/organizer-sidebar.tsx` | S2: UI, route lub wspĂłlny kontrakt |
| A | `src/components/operator/participant-merge-panel.tsx` | S4: UI, route lub wspĂłlny kontrakt |
| A | `src/components/participant-merge-preview.tsx` | S4: UI, route lub wspĂłlny kontrakt |
| A | `src/components/public/participant-identity-dialog.tsx` | S4: UI, route lub wspĂłlny kontrakt |
| M | `src/components/public/participant-join-gate.tsx` | S4: UI, route lub wspĂłlny kontrakt |
| A | `src/components/public/participant-presence.tsx` | S3: UI, route lub wspĂłlny kontrakt |
| M | `src/components/public/participant-profile-drawer.tsx` | S4: UI, route lub wspĂłlny kontrakt |
| M | `src/components/public/public-session-visual-fixture.tsx` | S2: UI, route lub wspĂłlny kontrakt |
| M | `src/components/public/session-api.ts` | S2, S4: UI, route lub wspĂłlny kontrakt |
| M | `src/components/public/session-participant-requests.tsx` | S1, S2: UI, route lub wspĂłlny kontrakt |
| M | `src/components/public/session-request-page.tsx` | S1, S4: UI, route lub wspĂłlny kontrakt |
| M | `src/components/public/session-state-alert.tsx` | S1: UI, route lub wspĂłlny kontrakt |
| M | `src/components/realtime/use-queue-realtime.ts` | S1, S2: UI, route lub wspĂłlny kontrakt |
| M | `src/db/schema.ts` | S1, S2, S3, S4: UI, route lub wspĂłlny kontrakt |
| M | `src/lib/dashboard-routes.ts` | S2: UI, route lub wspĂłlny kontrakt |
| A | `src/lib/participant-linking.ts` | S4: UI, route lub wspĂłlny kontrakt |
| A | `src/lib/participant-presence.ts` | S3: UI, route lub wspĂłlny kontrakt |
| A | `src/lib/participant-request-policy.ts` | S1: UI, route lub wspĂłlny kontrakt |
| M | `src/lib/queue-realtime.ts` | S1, S2: UI, route lub wspĂłlny kontrakt |
| A | `src/server/fair-queue.ts` | S5: API/serwis uczestnictwa i kolejki |
| A | `src/server/operator-api/event-participants-http.ts` | S2: API/serwis uczestnictwa i kolejki |
| A | `src/server/operator-api/event-participants.ts` | S2, S3, S4: API/serwis uczestnictwa i kolejki |
| M | `src/server/operator-api/event-queue.ts` | S1, S2, S5: API/serwis uczestnictwa i kolejki |
| A | `src/server/operator-api/fair-queue-store.ts` | S5: API/serwis uczestnictwa i kolejki |
| A | `src/server/operator-api/fair-queue.ts` | S5: API/serwis uczestnictwa i kolejki |
| A | `src/server/operator-api/participant-merge.ts` | S4: API/serwis uczestnictwa i kolejki |
| A | `src/server/participant-request-limit.ts` | S1: API/serwis uczestnictwa i kolejki |
| M | `src/server/public-api/queue-policy.ts` | S1: API/serwis uczestnictwa i kolejki |
| A | `src/server/session-api/identity-http.ts` | S4: API/serwis uczestnictwa i kolejki |
| A | `src/server/session-api/linking.ts` | S4: API/serwis uczestnictwa i kolejki |
| A | `src/server/session-api/participant-membership.ts` | S4: API/serwis uczestnictwa i kolejki |
| A | `src/server/session-api/presence.ts` | S3, S4: API/serwis uczestnictwa i kolejki |
| M | `src/server/session-api/rate-limit-core.ts` | S3, S4: API/serwis uczestnictwa i kolejki |
| M | `src/server/session-api/service.ts` | S1, S2, S3, S4: API/serwis uczestnictwa i kolejki |
| M | `tests/e2e/local-supabase-fixture.ts` | S1, S3, S4: Test/regresja/harness |
| M | `tests/e2e/public-event-session-identity.local.spec.ts` | S1, S2, S3, S4, S5: Test/regresja/harness |
| M | `tests/e2e/run-local-supabase-smoke.ts` | S3: Test/regresja/harness |
| A | `tests/eventParticipantsRealtimeMigration.test.ts` | S2: Test/regresja/harness |
| A | `tests/fairQueue.test.ts` | S5: Test/regresja/harness |
| A | `tests/participantLinkingMigration.test.ts` | S4: Test/regresja/harness |
| A | `tests/participantPresenceMigration.test.ts` | S3: Test/regresja/harness |
| M | `tests/postgres/canonicalSessionAccess.integration.test.ts` | S3: Test/regresja/harness |
| M | `tests/postgres/catalogCollections.integration.test.ts` | S3, S4: Test/regresja/harness |
| M | `tests/postgres/dbContention.integration.test.ts` | S4: Test/regresja/harness |
| M | `tests/postgres/dbTimeoutHierarchy.integration.test.ts` | S4: Test/regresja/harness |
| A | `tests/postgres/faultProcessHarness.ts` | S4 Recovery: Test/regresja/harness |
| M | `tests/postgres/guestSessionQueue.integration.test.ts` | S3, S4, S5: Test/regresja/harness |
| M | `tests/postgres/importJobDataFoundationContract.integration.test.ts` | S3: Test/regresja/harness |
| M | `tests/postgres/importJobWorkerFoundation.integration.test.ts` | S3: Test/regresja/harness |
| M | `tests/postgres/importWorkerRuntime.integration.test.ts` | S3: Test/regresja/harness |
| M | `tests/postgres/participantIdentity.integration.test.ts` | S1, S2, S3, S4, S5: Test/regresja/harness |
| M | `tests/postgres/participantSongDiscovery.integration.test.ts` | S3, S4: Test/regresja/harness |
| M | `tests/postgres/platformAdminImports.integration.test.ts` | S3: Test/regresja/harness |
| A | `tests/postgres/postgresDriverFault.integration.test.ts` | S4 Recovery: Test/regresja/harness |
| A | `tests/postgres/postgresDriverFault.worker.mjs` | S4 Recovery: Test/regresja/harness |
| M | `tests/postgres/postgresTestHarness.ts` | S3: Test/regresja/harness |
| M | `tests/postgres/publicEventSessionIdentity.integration.test.ts` | S3, S4: Test/regresja/harness |
| M | `tests/postgres/sessionCodeSixDigits.integration.test.ts` | S3: Test/regresja/harness |
| M | `tests/postgres/songPublicId.integration.test.ts` | S3: Test/regresja/harness |
| M | `tests/postgres/songSearchAdversarial.review.test.ts` | S3: Test/regresja/harness |
| M | `tests/postgres/songSearchQuality.integration.test.ts` | S3: Test/regresja/harness |
| M | `tests/postgres/songSearchSqlApiUi.integration.test.tsx` | S3: Test/regresja/harness |
| M | `tests/sessionCodeSixDigitsMigration.test.ts` | S2: Test/regresja/harness |
| M | `tests/sessionEventAccess.test.ts` | S4: Test/regresja/harness |
| M | `tests/vitest/app-shell-navigation.component.test.tsx` | S2: Test/regresja/harness |
| A | `tests/vitest/event-participants-panel.component.test.tsx` | S2, S3: Test/regresja/harness |
| A | `tests/vitest/event-participants-routes.test.ts` | S2, S3: Test/regresja/harness |
| M | `tests/vitest/event-queue-panel.component.test.tsx` | S1, S5: Test/regresja/harness |
| A | `tests/vitest/fair-queue-control.component.test.tsx` | S5: Test/regresja/harness |
| A | `tests/vitest/fair-queue-routes.test.ts` | S5: Test/regresja/harness |
| A | `tests/vitest/participant-linking-routes.test.ts` | S4: Test/regresja/harness |
| A | `tests/vitest/participant-linking.component.test.tsx` | S4: Test/regresja/harness |
| A | `tests/vitest/participant-presence-routes.test.ts` | S3: Test/regresja/harness |
| A | `tests/vitest/participant-presence.component.test.tsx` | S3: Test/regresja/harness |
| M | `tests/vitest/session-request-feedback.component.test.tsx` | S1, S2: Test/regresja/harness |
| M | `tests/vitest/session-state-alert.component.test.tsx` | S1: Test/regresja/harness |
| M | `tests/vitest/use-queue-realtime.test.tsx` | S2: Test/regresja/harness |
| M | `vitest.public-session-postgres.config.ts` | S1, S2, S4: Test/regresja/harness |
| A | `docs/features/foundation-checkpoint-audit.md` | Foundation checkpoint: ten raport, lista stagingu i decyzja approval |

### Dokładna lista wykluczonych zmian i lokalnych artefaktów

- `.codex/config.toml`: jedyna wykluczona tracked delta, prywatna zastana zmiana
  użytkownika, nie edytowana i nie stage'owana. Zachowano hash wejściowy.
- Poniższe aktualnie ignorowane pliki/katalogi; nie należą do listy commitowej
  (katalog oznacza również jego całą zignorowaną zawartość):
  - `.artifacts/`
  - `.auth/`
  - `.codex-next-dev.err.log`
  - `.codex-next-dev.out.log`
  - `.env`
  - `.env.local`
  - `.next-codex-db-runtime/`
  - `.next-codex-db-runtime/dev/`
  - `.next-codex-db-runtime/dev/logs/`
  - `.next-codex-db-runtime/dev/logs/next-development.log`
  - `.next/`
  - `.pnpm-store/`
  - `.vercel/`
  - `next-env.d.ts`
  - `node_modules/`
  - `test-results/`
  - `tsconfig.tsbuildinfo`

Stare tracked skille `.agents/skills` są już w HEAD i nie są zmienione;
nie dodawano ich ponownie. `data` i lokalne env pozostają bez zmian.
Kopie checkpointu/instalacji znajdują się poza repozytorium i nie są stage'owane.
Nie zmieniono .gitignore ani konfiguracji aplikacji. Wyjątek kontroli formatu
jednego patcha opisano poniżej; nie jest wykluczeniem pliku ze stagingu.

## Format patcha i kontrola staged diff

Pierwszy `git diff --cached --check` zakończył się exit 2: 24 trailing-whitespace
warnings w nowo stage'owanym `patches/postgres@3.4.9.patch`. Zweryfikowano
każdą wskazaną linię: każda zawierała wyłącznie jedną spację, czyli wymagany
marker pustego kontekstu unified diff. Nie były to nowe błędne spacje kodu.
Wcześniejszy unstaged diff check nie obejmował wtedy untracked patch file.
Pierwotny log zachowano w `foundation-cached-check-before-attributes.log`.

Nie przepisano patcha ani lockfile i nie regenerowano jego hasha. Dodano
jedną jawną regułę `.gitattributes`:

```
patches/postgres@3.4.9.patch text eol=lf whitespace=-blank-at-eol
```

Dotyczy wyłącznie tego pliku danych unified diff. LF chroni zgodność bajtów
z hashem pnpm także przy Windows checkout z autocrlf. Inne whitespace checks
pozostają aktywne; pliki kodu nadal mają standardowe reguły. `git check-attr`
potwierdza exact scope, a powtórzony canonical cached check przechodzi.
To jedyna korekta przygotowania Git poza raportem, bez wpływu na runtime,
schemat, sekrety lub odtworzenie pakietu. Wszystkie 125 zastanych kandydatów
zachowują SHA-256 wejściowego worktree.

## Findings, ograniczenia i gotowość Enterprise DnD

**Brak zweryfikowanego P0/P1 blokującego lokalny checkpoint.** Nie jest to
nieograniczone zaświadczenie bezpieczeństwa ani zgoda na produkcję.

1. **F-01, P2, VERIFIED: drift instrukcji AGENTS.md.** Sekcja Purpose nadal
   opisuje ukończone participant features jako planowane, Event rules opisuje
   pojedyncze public active event, podczas gdy wcześniejsza migracja 0022 i
   zastany kod obsługują wiele; rozbieżność była już w Slice 1 i nie pochodzi
   z tego checkpointu. Dowód: AGENTS.md Purpose/Event rules, 0022,
   participant-model-slice-1.md. Wpływ: przyszły agent może przypadkowo zmienić
   zaakceptowaną domenę. Minimalny follow-up: osobne uzgodnienie i aktualizacja
   dokumentacji bez zmiany runtime/schema. Recheck: porównanie instrukcji z
   trasami/migracjami i testami multi-event. Owner: właściciel projektu.
   Nie zmieniano zasad domenowych, nie blokuje zachowania istniejącego stanu.
2. **F-02, P2, RISK: utrzymanie patcha zależności.** Clean install i 22/22
   potwierdzają odtwarzalność obecnej wersji; nie dowodzą odporności dowolnej
   nowej wersji, workerd lub PgBouncer. Warunek usunięcia patcha: review
   stabilnego upstream replacement oraz fault suite, application PG i linking
   smoke. Owner: backend/dependency maintenance; blast radius wszystkie DB
   transactions/reservations. Nie wykonywano upgrade ani ponownego badania
   aktualnego release upstream, bo nie jest to potrzebne do checkpointu.
3. **F-03, P2, NOT VERIFIED / OUT OF SCOPE: środowiska docelowe.** Produkcyjne
   migracje, wersja silnika, WAF i monitoring nie były sprawdzane ani zmieniane.
   Przed deploymentem wymagane osobne approval środowiska, preflight 0028–0030
   i Auth/Realtime smoke. Nie wolno utożsamiać READY FOR APPROVAL z release GO.

Pozostałe znane granice ADR: lista/historia event-sized bez paginacji,
brak automatycznego undo merge, retencja zakończonych invitations/proposals
wymaga osobnej polityki, legacy null FK nie przypisuje się po nicku, brak
retroaktywnego waitCredit bez audytu, current-status semantics dla restore,
brak twardej gwarancji oczekiwania przy ręcznych interwencjach. Brak nowych
istotnych rozbieżności implementacji względem zaakceptowanych ADR.

**Gotowe jako fundament do osobno autoryzowanej modernizacji Enterprise DnD
po zatwierdzeniu checkpointu.** Zachować granice backend/API i mutexów,
kanoniczne odpowiedzi, optimistic pending operations, stale-preview/version
guards, RBAC/event scope, 2/2, nieruchome now i kontrolę ręcznej kolejności.
Regresje pointer/keyboard/mobile i Fair preview/apply mają pozostać bramką;
DnD nie może obliczać własnej fairness lub pisać bezpośrednio do business tables.
Nie implementowano DnD, i18n, Slice 6 ani rebrandingu.

## Narzędzia, działania i coverage ledger

Narzędzia bieżącego checkpointu: lokalne Git, PowerShell, Python stdlib,
pnpm 11.7.0/Node 24, Vitest/Testing Library, TypeScript, ESLint, Next build,
Drizzle Kit, Docker PostgreSQL 17. Registry npm/pnpm pobrano tylko do izolowanej
instalacji. Brak nowych MCP calls, GitHub API, Supabase remote MCP, Vercel,
Cloudflare i innych mutacji zdalnych. Historyczny browser używał lokalnego
Supabase CLI/Auth/Realtime i Playwright; nie uruchamiano ich ponownie tutaj.

| Soczewka | Status i metoda | Ograniczenie |
| --- | --- | --- |
| Git/provenance | DONE: status/refs/worktrees, per-file hash, staged diff, backup restore | Brak fetch; remote state niezweryfikowany |
| Architektura/domena | DONE: krytyczne call paths, ADR, handoffy i current diff | Nie rekonstruowano oddzielnych stanów pięciu slice'ów |
| DB/migracje | DONE: SQL, snapshot lineage/delta, Drizzle, real PG17 | Nie migrowano środowisk współdzielonych |
| Dependencies | DONE: frozen install w nowym store, 37 hashes i 22 raw fault cases | Bez runtime workerd/PgBouncer/advisory/CVE audit |
| API/auth/security | DONE dla guards/RBAC/RLS/CSRF/replay w kontrolowanych fixtures | Nie wykonano pełnego OS pentestu ani skanu historii Git |
| Tests | DONE: fresh unit/component, appropriate PG gates, build checks | Pełne niezwiązane import/load suites NOT RUN |
| Browser/Realtime/a11y | HISTORYCZNY PASS 10/10, potwierdzone niezmienione źródła | Brak świeżego browser, ręcznej akceptacji wizualnej lub produkcji |
| Staging/approval | READY FOR APPROVAL: 127 plików, private delta excluded | Commit/branch creation/push/deploy wymagają kolejnej decyzji użytkownika |

Końcowa granica: **zatrzymano się przed commitem**. Do zatwierdzenia pozostaje
konkretny staged checkpoint i powyższy plan gałęzi/commita, nie ogólna zgoda
na push, PR, deployment lub migracje.
