# Migration 0014: Multiple Platform Owners

## Cel

Migracja `0014_multiple_platform_owners.sql` usuwa partial unique index
`platform_members_one_active_owner_idx`, który ograniczał platformę do jednego
aktywnego `platform_owner`. Nie zmienia rekordów, ról, Supabase Auth ani stanu
suspension. Unikalny `platform_members_operator_idx` nadal gwarantuje najwyżej
jeden rekord platform membership dla operatora.

Eligible platform owner to operator, który ma aktywny `operator_users`, nie jest
zawieszony i ma aktywny `platform_members` z rolą `platform_owner`.

`completeOwnerLink` jest węższym, historycznym sygnałem kompletności obecnego
bootstrapu. Oprócz wszystkich warunków eligible ownera wymaga `auth_user_id`,
aktywnego workspace membership z rolą `owner` oraz aktywnego workspace.

Bootstrap po wdrożeniu kodu uznaje platformę za zainicjalizowaną, gdy istnieje
co najmniej jeden complete bootstrap owner link oraz co najmniej jeden
workspace. Ticket 7 nie może używać `completeOwnerLinks` jako definicji
ostatniego eligible ownera. Musi chronić ownera wyłącznie według zaakceptowanej
definicji eligible platform ownera. Ticket 7 musi zostać wdrożony przed
udostępnieniem mutacji ról lub suspension ownera.

Migracja 0014 nie została wykonana w ramach tego zadania.

## Preconditions

Przed wykonaniem należy:

1. Potwierdzić właściwy projekt i środowisko bez wypisywania sekretów.
2. Potwierdzić, że migracje do `0013_operator_suspension` włącznie zostały
   zastosowane, a `0014` nie figuruje jeszcze w historii migracji.
3. Potwierdzić obecność `platform_members_one_active_owner_idx` oraz
   `platform_members_operator_idx`.
4. Zanotować osobne agregaty aktywnych owner memberships, eligible owner
   memberships i complete bootstrap owner links bez ujawniania identyfikatorów.
5. Potwierdzić, że istnieje co najmniej jeden eligible platform owner oraz co
   najmniej jeden complete bootstrap owner link wymagany przez obecny setup.
6. Dla produkcji przygotować aktualny backup lub restore point i uzyskać
   osobną, jawną zgodę na migrację.

Migracja nie wymaga backfillu ani mutacji istniejących danych. Usunięcie indeksu
nie usuwa i nie zmienia obecnego ownera.

## Kolejność Wdrożenia

1. Zastosować i zweryfikować migrację `0013_operator_suspension`.
2. Wykonać preconditions i zapisać agregaty kontrolne ownerów.
3. Po osobnej zgodzie zastosować migrację `0014_multiple_platform_owners`.
4. Wykonać read-only verification poniżej.
5. Wdrożyć kod bootstrapu obsługujący jeden lub wiele complete bootstrap owner
   links bez wymagania dokładnie jednego aktywnego owner membership.
6. Przed udostępnieniem mutacji ownerów wdrożyć i zweryfikować Ticket 7.

## Read-only Verification

Poniższe zapytania są przeznaczone wyłącznie do użycia po zatwierdzonej
migracji. Nie zostały uruchomione w ramach tego zadania.

Brak starego indeksu i zachowanie indeksu operatora:

```sql
SELECT
  to_regclass('public.platform_members_one_active_owner_idx') IS NULL
    AS old_owner_index_removed,
  to_regclass('public.platform_members_operator_idx') IS NOT NULL
    AS operator_index_preserved;
```

Zachowanie enumu ról:

```sql
SELECT enumlabel
FROM pg_enum
JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
WHERE pg_type.typname = 'platform_member_role'
ORDER BY enumsortorder;
```

Trzy osobne agregaty ownerów i kompletności bootstrapu:

```sql
SELECT
  count(DISTINCT platform_members.id) FILTER (
    WHERE platform_members.active = true
      AND platform_members.role = 'platform_owner'
  ) AS active_owner_memberships,
  count(DISTINCT platform_members.id) FILTER (
    WHERE platform_members.active = true
      AND platform_members.role = 'platform_owner'
      AND operator_users.active = true
      AND operator_users.suspended_at IS NULL
  ) AS eligible_owner_memberships,
  count(DISTINCT platform_members.id) FILTER (
    WHERE platform_members.active = true
      AND platform_members.role = 'platform_owner'
      AND operator_users.active = true
      AND operator_users.suspended_at IS NULL
      AND operator_users.auth_user_id IS NOT NULL
      AND workspace_members.active = true
      AND workspace_members.role = 'owner'
      AND workspaces.active = true
  ) AS complete_owner_links
FROM public.platform_members
LEFT JOIN public.operator_users
  ON operator_users.id = platform_members.operator_user_id
LEFT JOIN public.workspace_members
  ON workspace_members.operator_user_id = operator_users.id
LEFT JOIN public.workspaces
  ON workspaces.id = workspace_members.workspace_id;
```

Po migracji wszystkie trzy agregaty muszą być zgodne z wartościami zapisanymi
przed migracją. `eligible_owner_memberships` używa wyłącznie zaakceptowanej
definicji eligible ownera i nie zależy od `auth_user_id`, workspace membership
ani workspace. `complete_owner_links` pozostaje dodatkowym warunkiem kompletności
obecnego bootstrapu. Dla zainicjalizowanej platformy musi wynosić co najmniej
`1`.

## Smoke Po Wdrożeniu Kodu

1. Jeden complete bootstrap owner link daje stan `initialized`.
2. Wiele complete bootstrap owner links również daje `initialized`.
3. Dodatkowe aktywne owner memberships nie wprowadzają wymagania dokładnie
   jednego ownera.
4. Aktywne owner memberships bez complete bootstrap owner linku dają
   `inconsistent`, nigdy `uninitialized`.
5. Istniejący owner zachowuje dostęp zgodny z dotychczasowym RBAC.

Smoke nie obejmuje tworzenia, zmiany ani usuwania ownerów, ponieważ usługi tych
mutacji oraz last-owner guard nie należą do Ticketu 6.

## Rollback I Forward-fix

Rollback przez ponowne utworzenie unikalnego
`platform_members_one_active_owner_idx` jest dopuszczalny wyłącznie wtedy, gdy
read-only verification potwierdzi najwyżej jednego aktywnego
`platform_owner`. Rollback wymaga osobnego review i zgody.

Jeżeli istnieje już wielu aktywnych ownerów, nie wolno próbować odtwarzać
unikalnego indeksu bez osobnej decyzji produktowej, planu danych i
zweryfikowanej strategii forward-fix. Nie wolno usuwać ownerów ani arbitralnie
dezaktywować membershipów w celu wymuszenia rollbacku.

Po wdrożeniu zależnego kodu preferowany jest kompatybilny forward-fix. Migracje
produkcyjne, rollback i forward-fix wymagają backupu/restore pointu, jawnej
zgody oraz ponownej read-only weryfikacji.

Rollback indeksu i Ticket 7 rozwiązują różne problemy. Ticket 7 musi liczyć
eligible platform owners według aktywnego lokalnego profilu, braku suspension i
aktywnego platform membership ownera. Nie może uzależniać last-owner guarda od
`auth_user_id`, workspace membership, workspace ani `completeOwnerLinks`.
