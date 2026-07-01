# Poza Nuta

## Import metadanych iSing

Importer buduje lokalny, prywatny indeks metadanych dostępnych utworow karaoke z iSing.

1. Skopiuj `.env.example` do `.env`.
2. Ustaw `ISING_CLIENT_ID`.
3. Uruchom:

```bash
pnpm import:ising
pnpm import:karafun
```

Wynik zostanie dopisany do wspolnego indeksu `data/imports/songs.json`, a raport importu w `data/imports/ising-import-report.json`.

## Import metadanych KaraFun z CSV

Importer KaraFun czyta lokalny CSV w formacie:

```text
Id;Title;Artist;Year;Duo;Explicit;"Date Added";Styles;Languages
```

Domyslny plik zrodlowy to `data/sources/karafuncatalog.csv`. Uruchom:

```bash
pnpm import:karafun
```

Mozesz tez podac wlasna sciezke przez `--input` albo ustawic `KARAFUN_CSV_PATH` w `.env`:

```bash
pnpm import:karafun --input "C:\Users\dmitr\Downloads\karafuncatalog.csv"
```

Wynik zostanie dopisany do `data/imports/songs.json`, a raport importu w `data/imports/karafun-import-report.json`.

KaraFun mapuje `Styles` na `genres`, `Languages` na `languages`, `Year` na `releaseYear`, `Duo` na `isDuet`, a `Explicit` na `isExplicit`. Te pola sa opcjonalne w lokalnym modelu, wiec rekordy iSing pozostaja zgodne z tym samym indeksem.

## Konfiguracja `.env`

Wspolne ustawienia sa ladowane przez `src/config/env.ts`. Najwazniejsze sciezki i ustawienia runtime:

```env
SONG_INDEX_PATH=data/imports/songs.json
KARAFUN_CSV_PATH=data/sources/karafuncatalog.csv
KARAFUN_IMPORT_REPORT_PATH=data/imports/karafun-import-report.json
ISING_CLIENT_ID=replace_me
API_HOST=127.0.0.1
API_PORT=4321
API_ADMIN_TOKEN=
```

API respektuje `SONG_INDEX_PATH`. Importer KaraFun domyslnie czyta `KARAFUN_CSV_PATH`, a `pnpm import:karafun --input <plik>` nadal nadpisuje tylko wejscie CSV dla danego uruchomienia.

### Konfiguracja klienta

`ISING_CLIENT_ID` pochodzi z publicznego requestu webowego iSing i nie jest traktowany jako prywatny sekret uzytkownika. Trzymamy go w `.env` tylko dlatego, ze moze sie zmienic i nie chcemy hardcodowac go w kodzie.

Importer domyslnie nie wymusza botowego User-Agenta. Jesli iSing poprosi o konkretny User-Agent albo dodatkowa identyfikacje ruchu, mozna ustawic `ISING_IMPORT_USER_AGENT`. `ISING_IMPORT_CONTACT_EMAIL` jest opcjonalne i sluzy tylko do wewnetrznej dokumentacji albo logowania.

### Paginacja iSing

iSing API uzywa offset pagination przez parametr `start`, np. `start=20`, `start=40`, `start=60`. Parametr `per_page=50` moze byc ignorowany albo limitowany przez API, dlatego importer nie moze na nim polegac.

Importer zawsze musi uzywac `links.next` z odpowiedzi API. Nie wolno recznie wyliczac kolejnych wartosci `start`; `links.next` jest jedynym zrodlem prawdy dla paginacji.

Ograniczenia:

- importer sluzy tylko do prywatnego indeksu metadanych dostepnosci piosenek karaoke,
- nie pobiera tekstow, audio, nagran, profili uzytkownikow ani komentarzy,
- nie wolno wystawiac pelnej kopii katalogu iSing publicznie,
- importer dziala tylko jako okresowy lokalny import metadanych i nie wolno uzywac go ani iSing API jako live proxy dla wyszukiwan uzytkownikow,
- po publikacji oficjalnego publicznego API iSing adapter nalezy wymienic na oficjalna integracje.

## Lokalne wyszukiwanie piosenek

Najpierw zbuduj lokalny indeks:

```bash
pnpm import:ising
```

Potem wyszukuj po lokalnie zaimportowanych metadanych:

```bash
pnpm search:songs "krolowa lez"
```

Wyszukiwarka czyta tylko `data/imports/songs.json` i nie odpytuje zewnetrznych serwisow. Pelny katalog importu nie powinien byc commitowany; pliki `data/imports/*.json` sa ignorowane przez git.

## Lokalna kolejka karaoke

To jest lokalny silnik kolejki bez UI, QR i endpointow HTTP. Dane eventow sa runtime i nie powinny byc commitowane; pliki `data/events/*.json` sa ignorowane przez git.

Przykladowy flow:

```bash
pnpm queue create --id test-event --name "Poza Nutą Test"
pnpm queue add --event test-event --singer "Michał" --title "Królowa Łez" --artist "Agnieszka Chylińska" --source ising --source-id 9053 --url "https://ising.pl/agnieszka-chylinska-krolowa-lez-piosenka"
pnpm queue approve --event test-event --request <request-id>
pnpm queue start --event test-event --request <request-id>
pnpm queue done --event test-event
pnpm queue public --event test-event
```

Kolejka dziala wylacznie na lokalnym JSON `data/events/<event-id>.json` i nie odpytuje iSing API podczas operacji kolejki.

Publiczny widok kolejki pokazuje aktualnie spiewajaca osobe jako `Now`, pierwsza zaakceptowana osobe jako `Next`, a `Upcoming` zawiera dopiero kolejne zaakceptowane requesty po `Next`.

## Dodawanie requestu z wyszukiwarki

Mozesz dodac request do kolejki bez recznego przepisywania tytulu, artysty, source id i URL-a. Komenda korzysta wylacznie z lokalnego indeksu `data/imports/songs.json` i nie odpytuje zewnetrznych serwisow.

Przykladowy flow:

```bash
pnpm import:ising
pnpm import:karafun
pnpm queue create --id test-event --name "Poza Nutą Test"
pnpm queue add-from-search --event test-event --singer "Michał" --query "krolowa lez"
pnpm queue approve --event test-event --request <id>
pnpm queue public --event test-event
```

Dodatkowe opcje:

- `--min-score <number>` ustawia minimalny confidence score, domyslnie `60`.
- `--pick <number>` wybiera konkretny wynik z top listy, numerowany od `1`.
- `--dry-run` pokazuje, co zostaloby dodane, ale nie zapisuje zmian do pliku eventu.

## Lokalne API karaoke

API jest lokalnym, dev-first mostem pod przyszly frontend, QR i panel operatora. Dziala wylacznie na lokalnych JSON-ach: `data/imports/songs.json` oraz `data/events/*.json`. API nie odpytuje zewnetrznych serwisow podczas wyszukiwania ani operacji kolejki.

Indeks utworow jest cache'owany w pamieci procesu API. Serwer laduje go przy starcie i odswieza leniwie, gdy zmieni sie sygnatura pliku `SONG_INDEX_PATH` (`mtime` albo rozmiar), dzieki czemu wyszukiwanie nie parsuje calego JSON-a przy kazdym requestcie.

Aplikacja API znajduje sie w `apps/api`. Domain/core pozostaje tymczasowo w rootowym `src` (`src/queue`, `src/search`, `src/importers`) jako etap przejsciowy przed ewentualnym wydzieleniem `packages/domain` i `packages/shared`.

Uruchomienie:

```bash
pnpm dev:api
```

`pnpm dev:api` dziala w watch mode przez natywne `node --watch`, wiec lokalny serwer API restartuje sie po zmianach kodu. Na tym etapie `nodemon` nie jest potrzebny. Jesli natywny watch Node okaze sie niewystarczajacy przy wiekszej strukturze repo, mozna pozniej rozwazyc `nodemon` albo `tsx`.

API loguje lokalnie requesty w formacie `[api] <requestId> <method> <path> <status> <durationMs>ms`. Kazda odpowiedz ma header `X-Request-Id`, co pomaga powiazac blad z frontendu z logiem backendu. Domyslnie `API_LOG_LEVEL=info`; ustaw `API_LOG_LEVEL=silent`, jesli chcesz wyciszyc access logi. Logi nie powinny zawierac pelnych body requestow, tokenow ani naglowka `Authorization`.

Domyslnie serwer binduje do `127.0.0.1:4321`. Konfiguracja:

```env
API_HOST=127.0.0.1
API_PORT=4321
API_ADMIN_TOKEN=
API_LOG_LEVEL=info
```

Jesli port `4321` jest zajety, zamknij poprzedni proces API albo ustaw inny `API_PORT`.

Git Bash/CMD:

```bash
netstat -ano | findstr :4321
cmd.exe /c "taskkill /PID <PID> /F"
```

PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 4321
Stop-Process -Id <PID> -Force
```

Jesli `API_ADMIN_TOKEN` jest ustawiony, endpointy operatorskie wymagaja naglowka `Authorization: Bearer <token>`. Publiczne endpointy i endpoint zgloszenia requestu uczestnika nie wymagaja tokena.

Health check:

```bash
curl http://127.0.0.1:4321/health
```

Lokalne wyszukiwanie, limitowane i bez zwracania pelnego katalogu:

```bash
curl "http://127.0.0.1:4321/api/search?q=krolowa%20lez"
```

Utworzenie eventu:

```bash
curl -X POST http://127.0.0.1:4321/api/events \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"test-event\",\"name\":\"Poza Nutą Test\"}"
```

Zgloszenie requestu uczestnika po lokalnym `sourceSongId`; tytul, artysta i URL sa brane z lokalnego indeksu, nie z body:

```bash
curl -X POST http://127.0.0.1:4321/api/events/test-event/requests \
  -H "Content-Type: application/json" \
  -d "{\"singerName\":\"Michał\",\"songSource\":\"ising\",\"songSourceId\":\"9053\"}"
```

Na Windows/Git Bash polskie znaki wpisane bezposrednio w `curl -d "{...}"` moga zostac wyslane w zlym kodowaniu terminala. Do recznych testow z polskimi znakami preferuj pliki JSON zapisane jako UTF-8.

`event.json`:

```json
{
  "id": "api-smoke",
  "name": "Poza Nutą API Smoke"
}
```

`request.json`:

```json
{
  "singerName": "Michał",
  "songSource": "ising",
  "songSourceId": "9053"
}
```

```bash
curl -X POST http://127.0.0.1:4321/api/events \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary @event.json
```

```bash
curl -X POST http://127.0.0.1:4321/api/events/api-smoke/requests \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary @request.json
```

Publiczna kolejka:

```bash
curl http://127.0.0.1:4321/api/events/test-event/public-queue
curl "http://127.0.0.1:4321/api/events/test-event/public-queue?hideSongTitles=true"
```

Kolejka operatora i akcje operatorskie:

```bash
curl http://127.0.0.1:4321/api/events/test-event/operator-queue
curl -X POST http://127.0.0.1:4321/api/events/test-event/requests/<request-id>/approve
curl -X POST http://127.0.0.1:4321/api/events/test-event/requests/<request-id>/start
curl -X POST http://127.0.0.1:4321/api/events/test-event/done
```

Publiczny frontend, QR i panel operatora sa nastepnym etapem; tutaj jest tylko lokalne API nad istniejacym search i queue core.

## Frontend MVP

Frontend MVP jest cienkim klientem React/Vite do lokalnego API. Nie odpytuje iSing i nie zawiera jeszcze QR, logowania, AI ani finalnego designu.

Flow lokalny:

```bash
pnpm import:ising
pnpm import:karafun
pnpm dev
```

`pnpm dev` uruchamia API i web rownolegle w jednym terminalu przez `concurrently`. Logi sa prefiksowane jako `API` i `WEB`, a zatrzymanie procesu konczy oba serwery. `concurrently` sluzy tylko do lokalnego dev workflow.

Adresy lokalne:

- API: `http://127.0.0.1:4321`
- Web: `http://127.0.0.1:5173`

Web dev server ma celowo staly port `5173` (`strictPort: true`). Jesli port `5173` jest zajety, zamknij poprzedni proces zamiast pozwalac Vite przejsc na `5174`, bo README, CORS i lokalne linki zakladaja `5173`.

Serwery mozna nadal uruchamiac osobno:

```bash
pnpm dev:api
pnpm dev:web
```

Utworz event:

```bash
curl -X POST http://127.0.0.1:4321/api/events \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "{\"id\":\"test-event\",\"name\":\"Poza Nutą Test\"}"
```

Adresy widokow:

- participant: `http://127.0.0.1:5173/event/test-event`
- public queue: `http://127.0.0.1:5173/event/test-event/public`
- operator: `http://127.0.0.1:5173/event/test-event/operator`

Konfiguracja frontendu:

```env
VITE_API_BASE_URL=http://127.0.0.1:4321
```

Participant view pozwala wpisac imie, wyszukac piosenke w lokalnym indeksie i wyslac pending request. Operator view pokazuje pending/approved/now/history i pozwala approve, reject, start, skip oraz done. Public view pokazuje Now, Next i Upcoming z pollingiem.
