# 0030 — urządzenia i scalenie uczestnictwa

Wymagane PostgreSQL 17 i migracje do 0029, w tym private/realtime. Migracja
addytywna: dwie prywatne tabele i dwa nullable pola event_participants, indeksy,
FK, CHECK i guardy zakresu. Istniejące membership pozostają canonical, więc
nie trzeba backfillu ani zgadywania własności. Brak delete/truncate/reset.
DDL jest transakcyjne; lock_timeout 5 s, statement_timeout 30 s. FK mają
jawne nazwy mieszczące się w limicie PostgreSQL. Snapshot i journal: 0030.

## Preflight i wdrożenie

Docelowe środowisko i migrację trzeba osobno zatwierdzić. Nie wykonano tej
migracji na produkcji ani na bazie skonfigurowanej w lokalnym .env. Testy
stosują izolowane PostgreSQL 17 i lokalny, tymczasowy Supabase Auth.

Kod wymaga 0030 przed uruchomieniem. Nowy merge utrzymuje aliasy membership;
po pierwszym merge stary kod bez obsługi aliasów nie jest bezpiecznym rollbackiem.
Zatrzymać finalizację nowych propozycji i wydać forward-fix zgodny z aliasami.
Po nieudanym DDL transakcja nie zostawia części schematu; zbadać blokady i
powtórzyć dopiero po usunięciu przyczyny. Nie wydłużać timeoutów w ciemno.

## Weryfikacja bez pobierania sekretów

```sql
select current_setting('server_version_num')::integer;
select relname, relrowsecurity from pg_class where oid in
  ('public.participant_device_links'::regclass, 'public.participant_merge_proposals'::regclass);
select conname, convalidated from pg_constraint where conrelid in
  ('public.participant_device_links'::regclass, 'public.participant_merge_proposals'::regclass,
   'public.event_participants'::regclass);
select has_table_privilege('anon', 'public.participant_device_links', 'SELECT'),
       has_table_privilege('authenticated', 'public.participant_merge_proposals', 'SELECT');
select count(*) from public.event_participants source
join public.event_participants target on target.id = source.merged_into_id
where source.event_session_id <> target.event_session_id
   or target.merged_into_id is not null or source.id = target.id;
select count(*) from public.song_requests r
join public.event_participants ep on ep.id = r.event_participant_id
where ep.merged_into_id is not null;
```

Oczekiwane: 170000–179999, RLS true, wszystkie constraints zweryfikowane,
przywileje false, obie ostatnie liczby 0. Browser roles nie mają polityk
czytania/zapisu nowych tabel ani EXECUTE prywatnych trigger functions.
Sprawdzić faktyczne odmowy jako anon/authenticated. Nie logować token_hash,
challenge_hash, verification_hash, cookies ani credentials.

## Dane i forward-fix

Device invitation ma TTL 3 min, proposal 5 min. Wykorzystanie atomowe;
receipt dostępny wyłącznie temu samemu challenge przez 10 min od wykorzystania.
Efemeryczny cookie ma TTL zaproszenia + 10 min dla retry po utracie odpowiedzi.
W tej migracji nie uruchamia się cleanup ani usuwania historii. Retencja
zakończonych zaproszeń/propozycji wymaga późniejszej, osobno zaprojektowanej
polityki; indeks expires_at ułatwia jej wdrożenie.

Source identity, credentials i aliasy nie są kasowane. Scalenie przenosi tylko
request membership FK i Presence membership FK, a stare aliasy spłaszcza.
Audit per request zapisuje proposal/source/target, a osobne wpisy opisują
przekierowanie aliasów i podsumowanie, bez tokenów i wielkich tablic JSON.
Daty, status, operator, public ID i wersja zgłoszenia pozostają zachowane.

Undo merge nie jest publiczną akcją. Przy błędnym przypisaniu potrzebna jest
oddzielnie autoryzowana, audytowana naprawa po analizie nowych zgłoszeń,
aliasów i sesji. Nie odtwarzać własności po nicku i nie odwracać FK zbiorczo
bez dowodów. Usuwanie tabel/kolumn, cofanie danych oraz retencja nie należą
do tego zadania.
