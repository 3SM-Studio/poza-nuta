# 0029: Participant Presence, PostgreSQL 17

Addytywna migracja Drizzle tworzy wyłącznie `participant_connections`, trzy
indeksy, dwa FK i wewnętrzny trigger invalidacji przy cofnięciu, zmianie
ważności lub usunięciu credential. Nie zmienia istniejących rekordów,
nie wymaga backfillu i nie przypisuje osób po nickach. RLS jest włączone,
brak polityk, wszystkie prawa anon/authenticated/PUBLIC są odebrane.
Źródłem danych pozostaje API i Drizzle. Snapshot 0029 nie zmienia starych tabel.

## Preflight

- Osobno autoryzować docelowe środowisko. Nie uruchomiono migracji na produkcji.
- Wymagane PostgreSQL 17, migracje do 0028, schema private i realtime.send.
- Zastosować cały łańcuch lokalnych migracji Slice 2/3 przed uruchomieniem kodu.
  Nowy kod odczytuje participant_connections; uruchomienie go przed 0029 da błąd.
- Krótki lock przy tworzeniu FK i triggera; lock_timeout 5 s, statement_timeout
  30 s. Drizzle wykonuje migrację transakcyjnie. Ryzyko danych: niskie,
  zgodności kod/schema i dostępności broadcastu: średnie.
- Nie modyfikować zastosowanego SQL we współdzielonym środowisku.

## Weryfikacja read-only

```sql
select current_setting('server_version_num')::integer;
select relrowsecurity from pg_class
where oid = 'public.participant_connections'::regclass;
select indexname from pg_indexes where tablename = 'participant_connections';
select conname, convalidated from pg_constraint
where conrelid = 'public.participant_connections'::regclass;
select has_table_privilege('anon', 'public.participant_connections', 'SELECT'),
       has_table_privilege('authenticated', 'public.participant_connections', 'INSERT');
select has_function_privilege('authenticated',
  'private.broadcast_presence_credential_changed()', 'EXECUTE');
select tgenabled from pg_trigger where tgname = 'participant_credential_presence_changed';
select count(*) from public.participant_connections
where heartbeat_at < created_at or expires_at < heartbeat_at;
```

Oczekiwane: wersja 170000–179999, RLS true, trzy indeksy oprócz PK,
zweryfikowane FK/check, przywileje false, trigger O, 0 błędnych rekordów.
Nie pobierać token_hash ani danych credentials do logów.
Obowiązkowe: realny Postgres 17, próby SELECT/INSERT jako anon/authenticated,
smoke prawdziwego Realtime, multi-tab, TTL bez beacona i reconnect.

## Retencja i bezpieczeństwo

Zamknięte połączenie jest tombstone: connect/heartbeat tego samego ID nie może
go wznowić. Każdy nowy rekord (także disconnect przed connect) usuwa maksymalnie
1000 rekordów tej efemerycznej tabeli z expires_at starszym niż 24 h,
z SKIP LOCKED. Bez nowych zapisów stare rekordy czekają na kolejną aktywność;
bez nowych zapisów nie rośnie też tabela. Nie usuwa się identity, credential,
membership ani historii. Indeks expires_at obsługuje ograniczony cleanup.
32 nowe ID/min/credential ogranicza również złośliwe disconnecty.
Heartbeat nie tworzy rekordów; po cleanup stary heartbeat dostaje 409.

## Rollback / forward-fix

Niepowodzenie samej migracji wycofuje jej transakcję. Po zastosowaniu
preferować nową migrację forward-fix. W razie problemu z funkcją poprawić
ją bez poszerzania praw klientów lub payloadów.

Bezpieczny rollback aplikacyjny wymaga wycofania kodu zależnego od 0029,
pozostawiając addytywną tabelę i trigger do późniejszej zatwierdzonej operacji.
Usunięcie triggera/funkcji/tabeli wymaga osobnego zatwierdzenia; nie jest
częścią tego zadania. Nie usuwać innych tabel ani polityk Realtime z 0028.
