# iSing Import

The iSing importer builds a private local Postgres index of karaoke song
metadata for Poza Nuta. It does not import lyrics, audio, backing tracks,
recordings, profiles, comments, or karaoke files.

The public application searches only the local Postgres `songs` table. It does
not call iSing live and does not proxy iSing API requests from app routes.

## Required environment variables

- `ISING_CLIENT_ID` - iSing client id used by the metadata endpoint.

The worker, not this legacy CLI, also requires `IMPORT_WORKER_DATABASE_URL`.
The worker connection is limited to the dedicated import-worker role.

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
pnpm db:import:ising --dry-run --limit 20
pnpm db:import:ising -- --dry-run --limit 20
```

`--limit` is a development convenience: it limits only mapped base-catalog
rows. The importer still fetches complete language and duet membership indexes
before mapping. It is not a low-traffic or semantically partial membership
import. Do not treat a limited run as a complete catalog verification.

## Full import

The legacy CLI deliberately refuses direct writes. After a full dry run has
completed safely, enqueue an `import_jobs` write job through the platform-admin
flow and run the worker in the intended environment:

```bash
pnpm import-worker:once
```

The adapter follows `links.next` from the API response, validates same-origin
pagination, collects complete metadata memberships before the first write, and
then upserts by `(source, source_song_id)`. It updates `lastSeenAt`,
`lastCheckedAt`, and `updatedAt`, and never deletes songs missing from the
current import.

The four sequential streams are the base catalog, `lang=pl`, `lang=-pl`, and
`tag=duet`. All HTTP requests share one request gate: the first request is
immediate and every later request waits at least `ISING_IMPORT_DELAY_MS`
(default 3000 ms), including stream transitions and retries. A request has at
most three attempts. Retryable 408, 425, 429, 5xx, timeout and network failures
use bounded backoff; 429 also honors a valid `Retry-After` in seconds or HTTP
date. A requested wait above 60 seconds is left to the existing worker retry
layer instead of issuing an early HTTP retry. Permanent 4xx are not retried at
the request level. Waits check the worker's cancellation checkpoint at most
every second.

Base song rows remain in memory until membership collection succeeds. The
three membership streams retain only stable source-song IDs and counters, not
full song objects. `import_jobs` counters remain `0/0` during this pre-write
collection because no songs have been processed. Enrichment coverage and HTTP
request counts are runtime/CLI diagnostics; no new durable `import_jobs` fields
are written.

`lang=pl` is the positive signal for the canonical `Polish` value. `lang=-pl`
is a separate source filter membership, not the mathematical complement of
`lang=pl`: a base record can occur in neither membership. The importer does not
guess languages. It stores `languages = ["Polish"]` only for `lang=pl` members;
all other base records, including `lang=-pl` members and unclassified records,
have `languages = []`. The current schema and product do not distinguish
confirmed non-Polish from unknown language.

## Data scope

Imported fields are limited to song metadata such as title, artist, duration,
genres, a canonical `Polish` membership when confirmed by `lang=pl`, the
complete `tag=duet` membership, public source URL, and boolean availability
flags. Lyrics, audio, backing tracks, recordings, profiles, comments, tokens,
and private account data are deliberately rejected or ignored. Fields such as
`sample_url` may appear in iSing responses; it is received but never used to
fetch media and never persisted. See [iSing metadata enrichment](features/ising-metadata-enrichment.md)
for the membership contract and failure safety.
Aggregate counters such as `recordings_count`, `comments_count`, `views_count`,
and `likes_count` may appear in iSing responses, but they are ignored because
the `songs` table has no fields for them.
