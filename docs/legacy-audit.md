# Legacy source audit — stan po usunięciu

Audyt zaktualizowano 2026-07-03 po fizycznym usunięciu legacy source folders z
working tree. Robocza, historyczna wersja wcześniejszego audytu znajduje się w
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

## Stan katalogów

| Katalog | Stan |
| --- | --- |
| `apps/api` | Usunięty z working tree |
| `apps/web` | Usunięty z working tree |
| dawna zawartość rootowego `src` | Usunięta; ścieżka jest ponownie używana przez aktywną aplikację |
| `data` | Zachowany jako lokalny workspace importów |

Kod usuniętych katalogów nadal jest dostępny w historii Git oraz w commitach
sprzed cleanupu. Archiwalne instrukcje w `docs/legacy` są dokumentacją
historyczną, a nie częścią aktywnego projektu.

Nowa aplikacja została później przeniesiona do `src/app`, `src/components`,
`src/server`, `src/db` i `src/lib`. Nie przywraca to usuniętego kodu legacy.

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

## Zachowany workspace `data`

Aktywny `pnpm db:import:karafun` domyślnie czyta lokalny plik
`data/sources/karafuncatalog.csv`. CSV jest ignorowany przez Git, ale sama
ścieżka jest nadal częścią kontraktu CLI.

Katalog `data` nie jest legacy source folderem usuwanym w tym kroku. Pozostaje
lokalnym workspace dla:

- `data/sources/karafuncatalog.csv`,
- `data/imports/.gitkeep` i lokalnych wyników importów,
- danych historycznych, które są ignorowane przez Git.

`data/sources` ani `data/imports` nie zostały usunięte.

## Zależności

Z `package.json` i lockfile usunięto:

- `vite`,
- `@vitejs/plugin-react`,
- `concurrently`.

Były używane tylko przez `apps/web` oraz wspólne uruchamianie legacy API/Vite.
Nie usunięto zależności wymaganych przez Next, React, Supabase, Drizzle,
Postgres, ESLint, TypeScript ani aktywne testy.

## Stan końcowy

Legacy Vite UI, lokalne Node API oraz dawne rootowe CLI/importery JSON nie
istnieją już w working tree. Ich odtworzenie wymaga sięgnięcia do historii Git.
Obecny katalog `src` zawiera wyłącznie aktywną aplikację opartą na Next.js,
Supabase, Drizzle i serwerowym imporcie KaraFun do Postgresa.
