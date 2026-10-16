# 0028: prywatna invalidacja uczestników wydarzenia

## Zmiana i zakres

Migracja `0028_event_participants_realtime.sql`, wygenerowana jako custom SQL
przez Drizzle, dodaje trigger na `event_participants`, dwie funkcje w `private`
i politykę SELECT na `realtime.messages`. Nie zmienia tabel biznesowych,
rekordów, indeksów ani istniejących kanałów kolejki. Snapshot 0028 zachowuje
schemat 0027; zmieniają się wyłącznie ID i prevId snapshotu.

Kanał: `dashboard:event:{internalEventId}:participants`, event:
`participants_changed`, private=true. Payload ma dokładnie `eventId`, `type`,
`operation`, `changedAt`; nie ma nicków, tożsamości, credential ani requestów.
Join, ręczne dodanie i rename powodują invalidację po transakcji.
Zmiany requestów są nadal obsługiwane przez istniejący kanał kolejki;
widok uczestników subskrybuje oba kanały i pobiera dane wyłącznie z API.

Polityka sprawdza aktywne workspace, membership i operatora, brak zawieszenia
oraz ścisłe dopasowanie tematu do wydarzenia organizacji. Viewer może czytać.
Anon i obca organizacja nie mogą subskrybować tego kanału. Nie ma polityki
INSERT dla klientów. Funkcje SECURITY DEFINER mają pusty search_path;
funkcja triggera nie jest wykonywalna przez role aplikacyjne.

## Preflight i ryzyko

- Wymagane zastosowane migracje 0004–0027 i dostępny Supabase Realtime.
- Zweryfikować projekt i środowisko przed jakąkolwiek operacją na zdalnej bazie.
- Sprawdzić istnienie `event_participants`, `event_sessions`, `workspace_members`,
  `operator_users.suspended_at`, `private` i `realtime.send`.
- Ryzyko: niskie dla danych; brak backfillu i constraintów. Utworzenie triggera
  wymaga krótkiego locka tabeli. Migracja ma lock_timeout 5 s i statement_timeout
  30 s. Błąd broadcastu może wycofać join/rename, zgodnie z istniejącym modelem
  triggerów kolejki. Przed wdrożeniem wymagany smoke rzeczywistego Realtime.
- Nie modyfikować SQL po zastosowaniu w współdzielonym środowisku.

## Weryfikacja odczytowa

```sql
select tgenabled from pg_trigger
where tgname = 'event_participants_broadcast_changed';

select schemaname, tablename, policyname, roles, cmd, qual
from pg_policies where schemaname = 'realtime'
  and policyname = 'event members can receive participant invalidations';

select proname, prosecdef, proconfig
from pg_proc join pg_namespace n on n.oid = pronamespace
where n.nspname = 'private' and proname in
  ('can_receive_event_participants', 'broadcast_event_participants_changed');

select has_function_privilege('anon',
  'private.can_receive_event_participants(text)', 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',
  'private.broadcast_event_participants_changed()', 'EXECUTE') as client_trigger;
```

Oczekiwane: trigger `O`, tylko SELECT dla authenticated, SECURITY DEFINER
z pustym search_path, oba przywileje false. Testy na izolowanym Postgresie
powinny ponadto wykonać SELECT jako authenticated/anon i sprawdzić RLS
dla własnego i obcego wydarzenia, suspended user oraz nieaktywnego membership.
Smoke: otwarty panel operatora widzi join przez QR bez odświeżania, do 5 s.

## Rollback / forward-fix

Przy błędzie w trakcie migracji transakcja Drizzle wycofuje dodane obiekty.
Po zastosowaniu preferować nową migrację forward-fix: poprawić funkcję
autoryzacji, payload lub trigger, zachowując nazwę i kontrakt tematu.
Nie usuwać uczestników, credentials ani requestów.

Awaryjne wycofanie wymaga osobnego zatwierdzenia środowiska i migracji:
usunąć trigger `event_participants_broadcast_changed`, następnie politykę
`event members can receive participant invalidations`, funkcję triggera i
`private.can_receive_event_participants(text)`. Nie usuwać schematu `private`
ani starych polityk/kanałów. UI może nadal używać ręcznego odświeżania;
nie zastępować invalidacji pollingiem.

Migrację przygotowano lokalnie, bez commita i bez wdrożenia na zdalny Supabase.
