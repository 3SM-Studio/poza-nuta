# Migration 0015: Platform Owner Guard

## Cel

Migracja `0015_platform_owner_guard.sql` dodaje database-level invariant, który
po utworzeniu pierwszego eligible platform ownera nie pozwala zejść do zera
eligible ownerów. Guard obejmuje także bezpośredni SQL, transakcje równoległe,
suspension, deactivation, demotion, delete oraz cascade delete operatora.

Eligible platform owner istnieje wyłącznie wtedy, gdy:

- `operator_users.active = true`;
- `operator_users.suspended_at IS NULL`;
- `platform_members.active = true`;
- `platform_members.role = 'platform_owner'`.

Definicja nie zależy od `auth_user_id`, workspace, workspace membership ani
`completeOwnerLinks`.

Migracja nie została uruchomiona na Supabase ani żadnej istniejącej bazie.

## Lifecycle `armed`

Tabela `private.platform_owner_guard` jest migration-owned i zawiera dokładnie
jeden rekord. `revision` serializuje owner-sensitive statements, a `armed`
rozróżnia dwa legalne stany:

1. Fresh/uninitialized: brak operatorów, platform memberships, workspace
   memberships i events oraz brak workspace albo dokładnie legacy workspace
   `Poza Nutą` / `pozanuta`. Guard zaczyna z `armed = false`.
2. Initialized: istnieje eligible owner. Guard zaczyna lub przechodzi na
   `armed = true`.

Pierwszy owner membership uzbraja guard w tej samej transakcji. Rollback setupu
cofa ownera i uzbrojenie. `armed = true` nigdy nie wraca do `false`. Dane
platformowe bez eligible ownera nie są traktowane jako fresh state: migracja lub
późniejszy statement kończy się kontrolowanym błędem.

## Preconditions

1. Potwierdzić właściwe środowisko bez wypisywania sekretów.
2. Potwierdzić zastosowanie `0013_operator_suspension` i
   `0014_multiple_platform_owners` oraz brak `0015` w historii migracji.
3. W initialized environment potwierdzić co najmniej jednego eligible ownera.
4. W fresh environment potwierdzić dokładnie dozwolony stan uninitialized.
5. Dla produkcji przygotować backup lub restore point i uzyskać osobną zgodę.
6. Wdrożyć migrację przed kodem Ticketów 8-9, który udostępni owner-sensitive
   mutacje.

Kolejność jest obowiązkowa: `0013` -> `0014` -> `0015` -> zależny kod.

## Zachowanie Migracji

Migracja blokuje tabele klasyfikowane przez guard na czas instalacji:
`events`, `operator_users`, `platform_members`, `workspace_members` i
`workspaces`.

- Eligible owner istnieje: singleton otrzymuje `armed = true`.
- Stan fresh/uninitialized jest poprawny: singleton otrzymuje `armed = false`.
- Inny stan bez eligible ownera: migracja przerywa się bez naprawy danych.

Stabilny kontrakt błędu to SQLSTATE `23514` i constraint identifier
`eligible_platform_owner_required`. Ticket 8 powinien bezpiecznie mapować ten
błąd oraz retryable `40001`; `40P01` jest dopuszczalny wyłącznie z pełnym
rollbackiem.

## Read-only Verification

Poniższe zapytania wolno wykonać dopiero po osobno zatwierdzonej migracji.

Stan singletona i liczba eligible ownerów:

```sql
SELECT singleton_key, revision >= 0 AS revision_valid, armed
FROM private.platform_owner_guard;

SELECT count(*) AS eligible_owner_memberships
FROM public.platform_members
JOIN public.operator_users
  ON operator_users.id = platform_members.operator_user_id
WHERE operator_users.active = true
  AND operator_users.suspended_at IS NULL
  AND platform_members.active = true
  AND platform_members.role = 'platform_owner';
```

Tabela musi zawierać dokładnie jeden rekord. Gdy `armed = true`, drugi wynik musi
być większy lub równy `1`.

Funkcje, security mode i pusty search path:

```sql
SELECT
  n.nspname,
  p.proname,
  p.prosecdef,
  p.provolatile,
  p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'private'
  AND p.proname IN (
    'serialize_platform_owner_transition',
    'validate_and_arm_platform_owner_guard',
    'protect_platform_owner_guard'
  )
ORDER BY p.proname;
```

Triggery i zwykłe `ENABLE`:

```sql
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  t.tgname,
  t.tgenabled
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND t.tgname LIKE '%platform_owner_guard%'
ORDER BY n.nspname, c.relname, t.tgname;
```

Każdy trigger musi mieć `tgenabled = 'O'`, a nie tryb `ALWAYS`.

Brak grantów dla zwykłych ról:

```sql
SELECT
  has_table_privilege('anon', 'private.platform_owner_guard', 'SELECT')
    AS anon_can_read,
  has_table_privilege('authenticated', 'private.platform_owner_guard', 'SELECT')
    AS authenticated_can_read,
  has_function_privilege(
    'anon',
    'private.serialize_platform_owner_transition()',
    'EXECUTE'
  ) AS anon_can_execute,
  has_function_privilege(
    'authenticated',
    'private.serialize_platform_owner_transition()',
    'EXECUTE'
  ) AS authenticated_can_execute;
```

Wszystkie wartości muszą być `false`.

## Concurrency Verification

W izolowanym PostgreSQL należy zweryfikować co najmniej równoczesne:
suspension+suspension, demotion+demotion, suspension+demotion,
delete+deactivation, dodanie replacement ownera i usunięcie ostatniego ownera
oraz dwie próby pierwszego setupu. Testy muszą objąć `READ COMMITTED`,
`REPEATABLE READ` i `SERIALIZABLE`.

Po każdej próbie liczba eligible ownerów pozostaje co najmniej `1` po uzbrojeniu,
nie ma częściowej mutacji, a odrzucona transakcja zwraca `23514`, retryable
`40001` albo kontrolowany `40P01` z pełnym rollbackiem.

## Verification Evidence

- Weryfikację wykonano 2026-07-15 na obrazie `postgres:15-alpine`.
- Użyto izolowanego kontenera bez persistent volume.
- Test objął pełny łańcuch migracji `0000`-`0015`.
- Testy concurrency wykonano dla `READ COMMITTED`, `REPEATABLE READ` i
  `SERIALIZABLE`.
- Nie użyto `DATABASE_URL`, Supabase ani żadnej istniejącej bazy.
- Kontener został usunięty po zakończeniu testów.

## Rollback I Forward-fix

Rollback przez usunięcie funkcji, triggerów i tabeli guarda jest dopuszczalny
wyłącznie przed wdrożeniem Ticketów 8-9 i przed udostępnieniem owner-sensitive
mutacji. Wymaga osobnego review, backupu/restore pointu oraz jawnej zgody.

Po udostępnieniu mutacji obowiązuje forward-fix. Nie należy usuwać guarda ani
cofać `armed`, ponieważ aplikacja może już polegać na jego invariantach.
Incydent lub błąd migracji należy naprawić kompatybilną kolejną migracją po
read-only diagnozie.
