# iSing Import

The iSing importer builds a private local Postgres index of karaoke song
metadata for Poza Nuta. It does not import lyrics, audio, backing tracks,
recordings, profiles, comments, or karaoke files.

The public application searches only the local Postgres `songs` table. It does
not call iSing live and does not proxy iSing API requests from app routes.

## Required environment variables

- `DATABASE_URL` - Postgres connection string for write imports.
- `ISING_CLIENT_ID` - iSing client id used by the metadata endpoint.

Optional:

- `ISING_API_BASE_URL` - defaults to `https://api.ising.pl/v2`.
- `ISING_IMPORT_DELAY_MS` - delay between pages, defaults to `3000`.
- `ISING_IMPORT_TAG` - optional search tag.
- `ISING_IMPORT_ORDER` - defaults to `-artist_string`.
- `ISING_IMPORT_LIMIT` - optional safety limit.
- `ISING_IMPORT_USER_AGENT` - optional custom User-Agent if iSing asks for one.

Do not commit `.env`, import outputs, large JSON files, or CSV sources.

## Test import

Use a dry run first. It fetches and maps metadata but does not write to
Postgres:

```bash
pnpm db:import:ising -- --dry-run --limit 20
```

For a small write import:

```bash
pnpm db:import:ising -- --limit 100
```

## Full import

Run only after migrations are applied and a test import looks healthy:

```bash
pnpm db:import:ising
```

The importer follows `links.next` from the API response. It upserts by the
existing unique key `(source, source_song_id)`, sets `source = "ising"`, updates
`lastSeenAt`, `lastCheckedAt`, and `updatedAt`, and never deletes songs missing
from the current import.

## Data scope

Imported fields are limited to song metadata such as title, artist, duration,
genres, languages when present, public source URL, and boolean availability
flags. Lyrics, audio, samples, backing tracks, recordings, profiles, comments,
tokens, and private account data are deliberately rejected or ignored.
