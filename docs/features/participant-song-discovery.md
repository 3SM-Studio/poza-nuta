# Participant Song Discovery

## Problem

Dotychczas uczestnik musiał znać tytuł albo wykonawcę, aby znaleźć utwór. To
wyklucza podstawowy flow karaoke: „nie wiem jeszcze, co zaśpiewać”.

## Goals

- udostępnić pełny, stronicowany katalog pod `/s/[token]/songs`;
- pozwolić przeglądać katalog bez zapytania tekstowego;
- zachować wyszukiwanie po tytule lub wykonawcy;
- udostępnić filtry wyłącznie dla istniejących, użytecznych danych;
- wysłać zgłoszenie tym samym canonical participant API co na stronie sesji;
- zachować istniejący lifecycle, participant credential i Realtime invalidation.

## Non-goals

- playlisty kuratorowane, CMS playlist lub panel organizatora;
- recommendation/ranking engine i personalizacja;
- filtrowanie po dekadach lub roku wydania;
- nowe migracje, indeksy, RLS albo osobny Realtime topic;
- ujawnianie użytkownikowi technicznych źródeł katalogu jako głównego UX.

## Routes

- `GET /s/[token]` — mały teaser „Odkrywaj” oraz wejście do katalogu;
- `GET /s/[token]/songs` — mobilny katalog, filtry i bezpośrednie zgłoszenie;
- `GET /api/s/[token]/songs/browse` — bounded, keyset-paginated catalog API;
- `GET /api/s/[token]/songs/discovery` — lekkie metadane kategorii i cech.

Wszystkie route'y używają canonical `publicToken`; legacy session code pozostaje
wyłącznie na istniejących ścieżkach compatibility.

## API

`/browse` akceptuje `cursor`, `limit`, `q`, `genre`, `language`, `duet`, `hit`
i `sort`. `limit` ma default `24` oraz hard max `40`. `q` używa tego samego
minimum dwóch znaków i normalizacji co aktualne publiczne wyszukiwanie.

`/discovery` zwraca deterministycznie uporządkowane `genres`, `languages` oraz
liczniki `duetCount`, `hitCount`, `plusCount`. Zwraca tylko publiczne etykiety
i liczności, bez wewnętrznych identyfikatorów ani danych uczestników.

## Pagination

Katalog nie wysyła całej tabeli `songs` do przeglądarki. Cursor jest URL-safe,
opaque dla klienta, sprawdzany serwerowo i związany z aktywną kombinacją
filtrów/sortowania. Każdy sort ma stabilny tie-breaker `id`:

- `title`: `normalized_title`, `normalized_artist`, `id`;
- `artist`: `normalized_artist`, `normalized_title`, `id`;
- `newest`: `created_at DESC`, `id DESC`.

## Filters and sorting

MVP udostępnia:

- gatunek i język z danych importu;
- tylko duety;
- tylko hity;
- tytuł A–Z, wykonawca A–Z oraz ostatnio dodane.

`Plus` nie jest teraz widocznym filtrem, ponieważ audyt DEVELOPMENT wykazał
zero rekordów. `Explicit` pozostaje informacyjnym badge'em, a nie główną
kategorią discovery.

## Data sources and data quality

Stage 2.5 korzysta wyłącznie z istniejącego modelu `songs`:
`title`, `artist`, `genres[]`, `languages[]`, flagi cech i daty importu.

KaraFun dostarcza przede wszystkim anglojęzyczne wartości katalogowe; iSing ma
częściowo polskie tagi oraz różnice case, np. `Pop/pop`, `Rock/rock` i
`Duet/duet`. API łączy tylko dokładne wartości różniące się wielkością liter,
przez canonical lower-case key. Nie wykonuje fuzzy taxonomy merge. Języki mają
spójną pisownię w aktualnych danych.

Pole `Year` z importu KaraFun jest obecnie tylko częścią `search_text`, więc
nie jest używane do dekad ani filtrów roku.

## Lifecycle and request integration

Browse i discovery wymagają tego samego live event + `songRequestsEnabled`
kontraktu co aktualne wyszukiwanie. Strona `/songs` zachowuje istniejący join
gate; wysłanie zgłoszenia zawsze wymaga HttpOnly participant credential.

CTA „Zgłoś” wywołuje wyłącznie `POST /api/s/[token]/requests`. Wykorzystuje
istniejące ownership, duplicate protection, safe errors oraz broadcast
`queue_changed`. Nie ma drugiego systemu requestów ani nowego topicu Realtime.

## Performance

Audyt DEVELOPMENT z 2026-08-17 obejmował 88 018 utworów. Bounded browse po
tytule używa istniejącego indeksu `songs_normalized_title_artist_idx`; realne
plany dla page-size 25 wyniosły około 3–7 ms dla default/search oraz poniżej
1 ms dla częstych filtrów pojedynczych. Najbardziej selektywny test złożony
wyniósł około 90 ms przy 88k rekordów, nadal bez nieograniczonego transferu.

Nie dodano indeksu GIN dla `genres[]`/`languages[]`: obecny rozmiar i bounded
keyset response nie uzasadniają migracji na zapas. Należy powtórzyć pomiar po
istotnym wzroście katalogu lub p95 latency.

## Tests

- unit/contract: query validation, hard limit, filter-bound cursor i canonical
  public route rate limiting;
- PostgreSQL 15/17: default browse, keyset pagination, stable sort, invalid
  cursor, max limit, search, filtry, empty result, lifecycle i invalid token;
- component: URL state, clear, race safety, load more, empty/error oraz submit
  i duplicate feedback;
- isolated E2E: join → browse bez wpisania tytułu → hit filter → submit →
  dashboard Realtime refetch bez F5 → „Moje zgłoszenia”.

## Future enhancements

- strukturalny `releaseYear` i dekady po osobnym modelu/migracji;
- curated playlists zarządzane przez organizatora;
- popularity analytics i rekomendacje;
- organizer-curated categories;
- taxonomy cleanup dla źródeł importu, jeśli dane będą tego wymagały.
