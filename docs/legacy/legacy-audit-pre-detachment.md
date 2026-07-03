# Legacy source audit — snapshot historyczny

> Ten dokument zachowuje roboczą wersję wcześniejszego audytu: pierwotny
> snapshot oraz częściowe adnotacje z przerwanej próby odłączenia. Nie opisuje
> stanu bieżącego; aktualny audyt znajduje się w `docs/legacy-audit.md`.

Audyt wykonano 2026-07-02 przed usuwaniem katalogów `apps/api`, `apps/web`,
`src` i `data`. W tym kroku nie usunięto ani nie przeniesiono żadnego pliku
legacy.

## Current detachment status

Aktywny workflow został odłączony od legacy tooling:

- z `package.json` usunięto `build:web`, `dev:api`, `dev:web`,
  `import:ising`, `import:karafun`, `queue` i `search:songs`;
- usunięto aktywne zależności toolingowe `vite`, `@vitejs/plugin-react` oraz
  `concurrently`;
- `pnpm test` uruchamia wyłącznie testy Next/Drizzle/Postgres i helperów
  aktualnego API;
- osiem plików testów legacy pozostaje w repo jako nieaktywna referencja, ale
  nie jest uruchamiane przez `pnpm test` ani obejmowane przez `tsconfig.json`;
- `tsconfig.json` nie obejmuje już `apps/api`, `apps/web` ani `src`;
- pomocnicze `scripts/lint.mjs` i `scripts/typecheck.mjs` nie odwołują się już
  do legacy roots;
- README wskazuje Next.js jako jedyny aktywny sposób uruchamiania, a dawne
  instrukcje są oznaczone jako historyczne.

Katalogi `apps/api`, `apps/web`, `src` i `data` nadal fizycznie istnieją.

### Co nadal blokuje fizyczne usunięcie

- `apps/api` i `apps/web` nie blokują już aktywnego workflow. Można je usunąć
  w osobnym, jawnym cleanupie razem z nieaktywnymi testami referencyjnymi.
- `src/importers/ising` nadal zawiera jedyną implementację importera iSing.
  Przed usunięciem `src` potrzebna jest decyzja: migracja do Postgresa,
  archiwizacja czy świadome wycofanie funkcji.
- `data/sources/karafuncatalog.csv` jest domyślnym lokalnym wejściem aktywnego
  `pnpm db:import:karafun`. Fizyczne usunięcie `data` wymaga zachowania lub
  zmiany tej lokalizacji.
- Lokalne JSON-y w `data/events` i `data/imports` mogą wymagać archiwizacji;
  nowa aplikacja ich nie używa, ale audyt nie rozstrzyga ich wartości
  historycznej.

## Pre-detachment snapshot (historical)

Pozostałe sekcje dokumentują stan sprzed odłączenia i nie są aktualnym opisem
aktywnego workflow. Zachowano je jako materiał do porównania podczas
fizycznego usuwania katalogów.

### Executive summary

Wszystkie cztery katalogi istnieją:

| Katalog | Trackowane pliki | Rola obecna |
| --- | ---: | --- |
| `apps/api` | 1 | Legacy lokalne API HTTP nad kolejką i indeksem JSON |
| `apps/web` | 8 | Legacy frontend React/Vite |
| `src` | 22 | Legacy importery, wyszukiwarka, kolejka JSON i wspólne typy |
| `data` | 2 pliki `.gitkeep` | Lokalny runtime/import storage; pozostałe dane są ignorowane |

Nowa aplikacja Next.js (`app`, `components`, `server`, `lib`) nie importuje
modułów z `apps/api`, `apps/web` ani `src`. Nie czyta też plików JSON z `data`
w runtime. To jednak nie oznacza, że katalogi można już usunąć: nadal są
podłączone do skryptów, testów, programu TypeScript i dokumentacji.

Jedyną bieżącą referencją spoza legacy do ścieżki `data` jest
`db/import-karafun-csv.ts`. Skrypt `pnpm db:import:karafun` domyślnie czyta
`data/sources/karafuncatalog.csv`.

## Dependency matrix

| Obszar | Next runtime | Testy | Skrypty / narzędzia | Konfiguracja |
| --- | --- | --- | --- | --- |
| `apps/api` | Brak importów | `tests/api.test.ts` importuje serwer | `pnpm dev:api` | Jawnie ujęty w `tsconfig.json` |
| `apps/web` | Brak importów | `tests/web.test.ts` importuje klienta API | `pnpm dev:web`, `pnpm build:web` | Jawnie ujęty w `tsconfig.json`; Vite używa go jako root |
| `src` | Brak importów | Importowany przez testy config/API/iSing/KaraFun/search/cache/queue | `pnpm import:ising`, `pnpm import:karafun`, `pnpm queue`, `pnpm search:songs`; używany przez `apps/api` | Jawnie ujęty w `tsconfig.json` |
| `data` | Brak odczytów JSON/CSV w requestach Next | Testy używają katalogów tymczasowych, nie repozytoryjnych danych runtime | Legacy API/CLI oraz bieżący `pnpm db:import:karafun` | Ścieżki są w `.env.example` i README |

### Build, typecheck and lint

- `pnpm build` buduje aplikację Next i nie ma bezpośredniego importu z legacy.
- `pnpm typecheck` używa `tsconfig.json`, który jawnie obejmuje `src`,
  `apps/api`, `apps/web` oraz `tests`. Testy importują legacy, więc usunięcie
  katalogów bez migracji testów spowoduje błędy rozwiązywania modułów.
- `pnpm lint` uruchamia ESLint, ale aktualny `eslint.config.mjs` ignoruje
  `apps/**`, `src/**`, `data/**`, `tests/**` i `scripts/**`. Zielony lint nie
  potwierdza więc samodzielnie gotowości legacy do usunięcia.
- Pomocnicze, obecnie niewywoływane z `package.json`, skrypty
  `scripts/typecheck.mjs` i `scripts/lint.mjs` również wymieniają katalogi
  legacy.

### Seed, database and imports

- `pnpm db:seed`, `pnpm db:seed:operator` oraz `pnpm db:link:operator-auth`
  nie importują kodu z katalogów legacy.
- `drizzle.config.ts` wskazuje wyłącznie `db/schema.ts` i `drizzle`.
- `pnpm db:import:karafun` używa kodu z `db`, ale zachowuje domyślną ścieżkę
  wejściową w `data/sources`.
- Importer iSing istnieje wyłącznie w `src/importers/ising`; nie ma jeszcze
  odpowiednika zapisującego katalog do Postgresa.
- Legacy importer KaraFun z `src/importers/karafun` zapisuje indeks JSON.
  Bieżący importer z `db` zapisuje do Postgresa, ale oba mają osobne testy i
  kontrakty.

### Workspace and documentation

- `pnpm-workspace.yaml` nie deklaruje pakietów workspace; zawiera tylko
  ustawienia dozwolonych buildów. `apps/web/package.json` nie tworzy obecnie
  osobnego pakietu zarządzanego przez workspace.
- `next.config.ts` nie zawiera referencji legacy.
- README nadal opisuje legacy API, Vite UI, lokalną kolejkę, wyszukiwarkę i
  importery JSON. Po decyzji o ich usunięciu dokumentację trzeba zaktualizować
  w tym samym cleanupie.
- `AGENTS.md` wskazuje `apps/api`, `apps/web`, `src` i `data` jako katalogi,
  których nie należy dotykać bez jawnego zakresu.

## Safe to delete now

Żaden z czterech całych katalogów nie jest dziś bezpieczny do usunięcia przy
zachowaniu wszystkich obecnych skryptów i testów.

Brak importów z runtime Next jest mocnym sygnałem, że `apps/api`, `apps/web`
i większość `src` nie są potrzebne do obsługi requestów produkcyjnej aplikacji.
Nie jest to jednak wystarczające do natychmiastowego usunięcia, ponieważ
repozytorium nadal deklaruje i testuje te narzędzia.

## Keep temporarily

### `apps/api`

Zachować do czasu wycofania `pnpm dev:api` i migracji albo usunięcia
`tests/api.test.ts`. Serwer zależy bezpośrednio od modułów `src/queue`,
`src/search`, `src/config` i `src/songs`.

### `apps/web`

Zachować do czasu wycofania `pnpm dev:web`, `pnpm build:web` i
`tests/web.test.ts`. Nowy publiczny UI oraz dashboard istnieją już w Next.js,
ale obecny kontrakt legacy klienta API nadal ma osobny test.

### `src`

Zachować jako źródło działających CLI i testowanej logiki legacy. Szczególnie
`src/importers/ising` nie ma jeszcze odpowiednika Postgres. `apps/api` również
nie działa bez `src`.

### `data`

Zachować co najmniej `data/sources` do czasu zmiany domyślnej ścieżki bieżącego
importera Postgres. `data/imports` i `data/events` są lokalnym storage legacy;
ich zawartość jest ignorowana przez Git, a `.gitkeep` utrzymują strukturę.

## Migrate before delete

1. **Testy:** przenieść wartościowe przypadki zachowania kolejki, search i
   API do testów `server/*`/Next albo jawnie zaakceptować ich usunięcie.
2. **iSing:** zdecydować, czy importer jest nadal potrzebny. Jeśli tak,
   zmigrować go do Postgresa i modelu `import_jobs` przed usunięciem
   `src/importers/ising`.
3. **KaraFun JSON:** porównać pokrycie i kontrakty starego importera z
   `db/import-karafun-csv.ts`, a następnie usunąć stary skrypt i testy JSON.
4. **Queue/search CLI:** zdecydować, czy lokalne CLI pozostają wspieranym
   narzędziem. Jeśli nie, usunąć ich skrypty i zastąpić potrzebne testy testami
   usług Postgres.
5. **Package scripts/config:** usunąć legacy skrypty z `package.json`, wpisy z
   `tsconfig.json` oraz referencje z pomocniczych skryptów.
6. **Dependencies:** po usunięciu Vite UI sprawdzić i usunąć nieużywane
   `vite`, `@vitejs/plugin-react` oraz inne zależności służące wyłącznie legacy.
7. **Data path:** przenieść albo świadomie zachować ścieżkę
   `data/sources/karafuncatalog.csv` używaną przez `db:import:karafun`.
8. **Dokumentacja:** usunąć lub zarchiwizować sekcje README dotyczące lokalnego
   API, Vite UI, kolejki JSON i starego import flow.

## Unclear / requires decision

- Czy importer iSing ma zostać rozwijany, zamrożony jako narzędzie ręczne, czy
  całkowicie wycofany?
- Czy lokalne CLI kolejki i wyszukiwarki są nadal potrzebne do operacji lub
  diagnostyki poza aplikacją Next?
- Czy lokalne pliki w `data/events` i `data/imports` zawierają historię, którą
  trzeba zarchiwizować albo zmigrować przed usunięciem katalogów? Audyt nie
  odczytuje ich jako źródła prawdy dla nowej aplikacji.
- Czy testy legacy mają zostać zachowane jako testy referencyjne domeny, czy
  zastąpione odpowiednikami dla Postgresa?
- Czy `data/sources` ma pozostać standardową lokalizacją wejściowych katalogów,
  mimo późniejszego usunięcia pozostałych części `data`?

## Recommended deletion order

1. Podjąć powyższe decyzje produktowe.
2. Zmigrować brakujące testy i importer iSing.
3. Wycofać skrypty legacy i zaktualizować README/konfigurację.
4. Usunąć `apps/web`.
5. Usunąć `apps/api`.
6. Usunąć nieużywane części `src`.
7. Na końcu uporządkować `data`, pozostawiając świadomie wybraną lokalizację
   wejściowego CSV.

Po każdym etapie należy uruchomić `pnpm test`, `pnpm typecheck`, `pnpm lint`
i `pnpm build`.
