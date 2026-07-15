# Migration 0013: Operator Suspension

## Cel

Migracja `0013_operator_suspension.sql` dodaje do `operator_users` aplikacyjny
stan zawieszenia niezależny od `active` i od tożsamości Supabase Auth. Dodaje
nullable pola `suspended_at`, `suspension_reason` i
`suspended_by_operator_id`, self-reference do operatora wykonującego operację
oraz constraint spójności stanu. Aktualizuje również prywatny guard Realtime,
aby dostęp wymagał jednocześnie `active = true` i `suspended_at IS NULL`.

Migracja musi zostać zastosowana przed wdrożeniem kodu, który odczytuje
`operator_users.suspended_at`. Migracja 0013 nie została jeszcze uruchomiona na
żadnej bazie w ramach tego zadania.

## Preconditions

Przed migracją należy:

1. Potwierdzić właściwy projekt i środowisko bez wypisywania sekretów.
2. Potwierdzić, że zastosowano wszystkie migracje do `0012` włącznie i że
   `0013` nie figuruje jeszcze w historii migracji.
3. Potwierdzić istnienie tabeli `public.operator_users` i funkcji
   `private.is_active_dashboard_operator()` utworzonej przez migrację `0004`.
4. Potwierdzić brak równoległego wdrożenia kodu odczytującego `suspended_at`.
5. Dla produkcji przygotować aktualny backup lub restore point oraz uzyskać
   osobną, jawną zgodę na wykonanie migracji.

Migracja jest addytywna. Nie wymaga backfillu: istniejące rekordy otrzymują
trzy wartości `NULL`, czyli pozostają niezawieszone.

## Read-only Verification

Poniższe zapytania są przeznaczone wyłącznie do wykonania po zatwierdzonej
migracji. Nie zostały uruchomione w ramach przygotowania tego runbooka.

Obecność trzech kolumn:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'operator_users'
  AND column_name IN (
    'suspended_at',
    'suspension_reason',
    'suspended_by_operator_id'
  )
ORDER BY column_name;
```

Obecność self-FK i constraintu stanu:

```sql
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name = 'operator_users'
  AND constraint_name IN (
    'operator_users_suspended_by_operator_id_operator_users_id_fk',
    'operator_users_suspension_state_check'
  )
ORDER BY constraint_name;
```

Brak rekordów w częściowym stanie zawieszenia; oczekiwany wynik to `0`:

```sql
SELECT count(*) AS inconsistent_suspension_rows
FROM public.operator_users
WHERE NOT (
  (
    suspended_at IS NULL
    AND suspension_reason IS NULL
    AND suspended_by_operator_id IS NULL
  )
  OR
  (
    suspended_at IS NOT NULL
    AND suspension_reason IS NOT NULL
    AND char_length(suspension_reason) BETWEEN 1 AND 500
    AND suspension_reason = btrim(suspension_reason)
    AND suspended_by_operator_id IS NOT NULL
  )
);
```

Definicja prywatnego guarda Realtime:

```sql
SELECT pg_get_functiondef(
  'private.is_active_dashboard_operator()'::regprocedure
);
```

Definicja musi zawierać oba warunki:

```text
operator_users.active = true
operator_users.suspended_at IS NULL
```

## Smoke Po Wdrożeniu Kodu

Po zastosowaniu migracji i wdrożeniu kodu należy sprawdzić bez ujawniania
cookies, tokenów ani danych wrażliwych:

1. Aktywny, niezawieszony operator może się zalogować i otworzyć dashboard.
2. `/api/dashboard/me` zwraca zwykły profil bez `suspensionReason` i bez danych
   aktora zawieszenia.
3. Konto `active = false` nadal otrzymuje dotychczasową odmowę dostępu.
4. Kontrolowany testowy rekord zawieszony otrzymuje bezpieczne
   `403 OPERATOR_SUSPENDED`, mimo aktywnego membershipu organizacji lub
   platformy.
5. Zawieszony operator nie może subskrybować prywatnego dashboardowego kanału
   Realtime.
6. Signup i setup nadal tworzą operatora z trzema polami suspension równymi
   `NULL`.

Smoke zawieszonego konta wymaga osobno zatwierdzonych, jednorazowych danych
testowych i nie może zmieniać istniejących użytkowników produkcyjnych.

## Rollback I Forward-fix

Rollback przez usunięcie constraintu, FK i trzech kolumn jest dopuszczalny
wyłącznie przed wdrożeniem kodu odczytującego `suspended_at` oraz przed
zapisaniem jakiegokolwiek stanu suspension. Rollback musi także przywrócić
poprzednią definicję `private.is_active_dashboard_operator()` i podlegać
osobnemu review oraz zgodzie.

Po wdrożeniu zależnego kodu albo po pierwszym użyciu suspension nie wolno usuwać
kolumn. Obowiązuje wtedy kompatybilny forward-fix zachowujący dane, FK i historię
stanu. Produkcyjny rollback lub forward-fix wymaga backupu/restore pointu,
planu weryfikacji i osobnej zgody operacyjnej.
