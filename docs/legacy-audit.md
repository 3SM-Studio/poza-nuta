# Legacy source audit — stan po odłączeniu

Audyt zaktualizowano 2026-07-03 po odłączeniu narzędzi Vite/Node/local-JSON od
aktywnego projektu. Robocza, historyczna wersja wcześniejszego audytu znajduje
się w
[`docs/legacy/legacy-audit-pre-detachment.md`](legacy/legacy-audit-pre-detachment.md).

## Stan aktywnego workflow

Aktywną aplikacją jest rootowy Next.js App Router korzystający z Supabase
Postgres, Drizzle ORM i Supabase Auth SSR.

Odłączono:

- skrypty `build:web`, `dev:api`, `dev:web`, `import:ising`,
  `import:karafun`, `queue` i `search:songs`;
- zależności służące wyłącznie legacy frontendowi i wspólnemu dev runnerowi:
  `vite`, `@vitejs/plugin-react` oraz `concurrently`;
- testy importujące `apps/api`, `apps/web` i moduły lokalnego JSON/CLI ze
  starego `src`;
- katalogi `apps/api`, `apps/web` i `src` z programu TypeScript oraz
  pomocniczych skryptów lint/typecheck;
- instrukcje uruchamiania legacy API, Vite UI, importerów JSON, wyszukiwarki i
  kolejki z głównego README.

`pnpm test`, `pnpm typecheck`, `pnpm lint` i `pnpm build` dotyczą obecnie
wyłącznie aktywnej aplikacji oraz jej narzędzi. README opisuje Next/Supabase/
Drizzle, a dawne instrukcje znajdują się tylko w `docs/legacy`.

## Fizycznie zachowane katalogi

| Katalog | Stan po odłączeniu |
| --- | --- |
| `apps/api` | Zachowany jako referencja; brak aktywnych scripts/testów/typecheck |
| `apps/web` | Zachowany jako referencja; brak Vite scripts, testów i dependencies |
| `src` | Zachowany jako referencja starego CLI, importerów i domeny JSON |
| `data` | Zachowany dla lokalnych danych oraz wejścia aktywnego importera KaraFun |

Nowa aplikacja w `app`, `components`, `server`, `db` i `lib` nie importuje
`apps/api`, `apps/web` ani starego `src`.

## Usunięte testy legacy

Z aktywnego katalogu `tests` usunięto:

- `api.test.ts`,
- `web.test.ts`,
- `config.test.ts`,
- `ising.test.ts`,
- `karafun.test.ts`,
- `queue.test.ts`,
- `search.test.ts`,
- `songIndexCache.test.ts`.

Testy te sprawdzały wycofane lokalne API, Vite client, stare importery
zapisujące JSON oraz lokalne search/queue CLI. Zachowane testy dotyczą
aktywnego Next API, helperów UI, lifecycle eventu i importera Postgres.

## Co nadal blokuje fizyczne usunięcie

### `apps/api` i `apps/web`

Nie blokują już builda ani workflow developerskiego. Ich fizyczne usunięcie
wymaga wyłącznie osobnego, jawnego cleanupu i ewentualnej decyzji, czy kod ma
zostać zachowany poza główną gałęzią jako materiał historyczny.

### `src`

`src/importers/ising` jest nadal jedyną implementacją importu iSing. Przed
usunięciem całego `src` trzeba zdecydować, czy importer:

- zostanie świadomie wycofany,
- zostanie zarchiwizowany,
- czy zostanie przepisany na aktywny model Postgres/import_jobs.

Pozostałe moduły `src` obsługują wycofany lokalny JSON search/queue flow i nie
są potrzebne aktywnej aplikacji.

### `data`

Aktywny `pnpm db:import:karafun` domyślnie czyta lokalny plik
`data/sources/karafuncatalog.csv`. CSV jest ignorowany przez Git, ale sama
ścieżka jest nadal częścią kontraktu CLI.

Przed usunięciem `data` trzeba:

- zachować lub zmienić domyślną ścieżkę wejściową importera Postgres;
- zdecydować, czy lokalne pliki w `data/events` i `data/imports` wymagają
  archiwizacji;
- zachować wymagane pliki `.gitkeep` do czasu osobnego cleanupu katalogu.

## Zależności

Z `package.json` i lockfile usunięto:

- `vite`,
- `@vitejs/plugin-react`,
- `concurrently`.

Były używane tylko przez `apps/web` oraz wspólne uruchamianie legacy API/Vite.
Nie usunięto zależności wymaganych przez Next, React, Supabase, Drizzle,
Postgres, ESLint, TypeScript ani aktywne testy.

## Następny bezpieczny krok

1. Podjąć decyzję dotyczącą importera iSing i danych historycznych.
2. W osobnym zadaniu usunąć `apps/web` i `apps/api`.
3. Usunąć niepotrzebne części `src` po decyzji o iSing.
4. Na końcu uporządkować `data`, zachowując świadomie wybraną lokalizację
   wejściowego CSV.

Każdy etap powinien kończyć się przez `pnpm test`, `pnpm typecheck`,
`pnpm lint` i `pnpm build`.
