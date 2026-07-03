# Poza Nutą

Aktywnym projektem jest jedna aplikacja Next.js App Router uruchamiana z
głównego katalogu repozytorium. Dane biznesowe są przechowywane w Supabase
Postgres przez Drizzle ORM, a dashboard operatora korzysta z Supabase Auth SSR.

## Uruchomienie lokalne

Wymagany jest Node.js 24 lub nowszy oraz pnpm.

```bash
pnpm install
pnpm dev
```

Aplikacja jest dostępna domyślnie pod `http://localhost:3000`.

Najważniejsze widoki:

- `/` — publiczne wyszukiwanie piosenek i dodawanie zgłoszeń,
- `/queue` — publiczny podgląd kolejki,
- `/sign-in` — logowanie do dashboardu,
- `/dashboard` — przegląd aktywnego eventu,
- `/dashboard/queue` — zarządzanie kolejką,
- `/dashboard/settings` — ustawienia eventu.

## Konfiguracja

Skopiuj `.env.example` do lokalnego `.env` i uzupełnij wymagane wartości.
Nie commituj `.env` ani sekretów Supabase.

Połączenie z bazą korzysta wyłącznie z serwerowego `DATABASE_URL`. Aplikacja nie
używa `NEXT_PUBLIC_*` do połączenia z Postgres.

## Baza danych i import KaraFun

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm db:seed:operator
pnpm db:link:operator-auth
pnpm db:studio
```

Importer katalogu KaraFun zapisujący dane do Postgresa:

```bash
pnpm db:import:karafun
pnpm db:import:karafun -- "C:\ścieżka\do\karafuncatalog.csv"
```

Domyślnym lokalnym wejściem jest `data/sources/karafuncatalog.csv`. Pliki CSV
w tym katalogu są ignorowane przez Git.

## Kontrole jakości

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Aktywny test suite obejmuje aplikację Next, API, helpery klienta, cykl życia
eventu oraz importer KaraFun do Postgresa. Testy dawnego API, Vite UI i
lokalnego przepływu JSON zostały wycofane.

## Kod legacy

Legacy source folders `apps/api`, `apps/web` i rootowe `src` zostały usunięte z
working tree po odłączeniu ich od build/test/typecheck/lint. Kod pozostaje
dostępny w historii Git. Katalog `data` pozostaje lokalnym workspace importów,
w tym domyślną lokalizacją wejściowego katalogu KaraFun.

- Bieżący stan usunięcia: [`docs/legacy-audit.md`](docs/legacy-audit.md)
- Archiwalne instrukcje: [`docs/legacy/README-legacy.md`](docs/legacy/README-legacy.md)

## Eksport do review

Do przekazania źródeł używaj archiwum z aktualnego commita:

```bash
git archive --format=zip --output poza-nuta-src.zip HEAD
```

Nie pakuj całego working directory. `.env`, `.next`, `node_modules`, lokalne
logi, cache i wejściowe pliki CSV muszą pozostać poza archiwum.
