# iSing metadata enrichment

## Scope

Poza Nutą keeps a local metadata index of iSing songs. The application never
calls iSing from participant routes and never imports lyrics, recordings,
profiles, audio, or other user content.

The base `GET /v2/search` song payload provides stable song IDs, title, artist,
`genre`, `duration`, `hit`, `plus`, `bpm`, and `date_added`. It does not provide
a per-song language, duet, or release-year field.

## Base data and membership data

The importer first reads the complete base catalog, then reads complete filter
memberships. It maps and writes batches only after every required membership
fetch completes:

1. base catalog;
2. language filter memberships;
3. `tag=duet` membership;
4. completeness checks and enrichment map construction;
5. deterministic mapping and idempotent upsert by `(source, source_song_id)`.

This makes language and duet metadata fail closed: a 403, 429, timeout,
challenge page, invalid JSON, unstable `found` count, or broken pagination
prevents enrichment writes. Existing metadata is not cleared from an incomplete
membership run. Duplicate stable IDs in a membership result are also treated as
incomplete, because they could hide an omitted membership. Once enrichment is
complete, the existing worker still commits normal bounded upsert batches; it
does not hard-delete unseen songs.

Base song objects remain in memory until all memberships pass validation.
Language and duet streams keep only stable source-song ID sets and aggregate
counters. They discard titles, artists, URLs, and other per-song fields after
each page. The complete-membership rule also applies when `--limit` bounds the
number of base rows; that option is for controlled development output, not a
partial membership crawl. At the previously reported catalog size of about
2,754 songs, this is expected to require memory in the tens of megabytes rather
than hundreds, but no heap measurement has been taken. Growth of the catalog
should be measured before using much larger sources.

## Language taxonomy

Observed public iSing Song Explorer options on 2026-08-18:

| iSing filter | Visible label | Poza Nutą canonical language | Meaning |
| --- | --- | --- | --- |
| `lang=pl` | Polskie | `Polish` | Positive server-side membership. |
| `lang=-pl` | Zagraniczne | — | Non-Polish filter membership, not a named language. |

`Polish` intentionally matches the existing KaraFun canonical value. The
`Zagraniczne` filter membership is collected for coverage verification only; it
is not written as a fictitious `Foreign` language. The importer maps only the
positive `lang=pl` membership to `languages = ["Polish"]`. Both `lang=-pl`
members and unclassified base records retain `languages = []`; this means no
canonical language is confirmed, not confirmed non-Polish.

On 2026-09-16, two consecutive live read-only collections returned identical
membership IDs: 2,798 base records, 2,032 `lang=pl` records, 758 `lang=-pl`
records, no intersection, and 8 base records in neither membership. The API
does not explain why those records are unclassified. This confirms that
`lang=-pl` is not a complete mathematical complement of `lang=pl`; the
importer must not infer a language from title, artist, or other metadata.

The schema currently does not distinguish known non-Polish filter membership
from unknown language, and the current product only uses positive canonical
language categories for discovery and filtering. No additional language label
is persisted for either case.

`songs.languages` is an array. The enrichment builder therefore supports
multiple confirmed memberships and deduplicates them deterministically, even
though the currently observed public iSing taxonomy exposes only the Polish
positive membership.

## Duets and other fields

`isDuet` comes exclusively from a complete `tag=duet` membership. A song is not
classified as a duet merely because its source `genre` contains `duet`; those
are distinct iSing contracts. After a complete duet run, visible base songs not
in that membership receive `isDuet = false`.

`genre[]`, `hit`, `plus`, and `duration` are mapped directly from the verified
base payload. `bpm` is observed but intentionally not stored because the schema
has no BPM column. `tag=lata-80` is category membership, not a precise release
year; this stage does not write `releaseYear` or add a schema migration.

The same 2026-09-16 base observation found `plus=true` on 0 records,
`plus=false` on 2,798 records, and no missing `plus` values. This is an
observation of that source snapshot, not a future API guarantee; `isPlus`
remains mapped normally. Eight base records mapped to empty `genre[]`; none of
them overlapped the eight unclassified-language records.

## Request and rate-limit safety

The API currently honors `limit=50`; `per_page` can be ignored. Pagination
always follows iSing's returned `links.next` URL and validates that it remains
on the expected iSing `/v2/search` origin/path. All four streams are sequential
and share one request gate. The first HTTP request is immediate; every later
request waits at least the configured interval (default 3000 ms), including
transitions between streams. Waits check the existing worker cancellation
checkpoint in steps of at most one second.

Each HTTP request has at most three attempts. 408, 425, 429, 5xx, timeout, and
network failures use bounded backoff of at least 3 and then 6 seconds. For 429,
a valid `Retry-After` in seconds or HTTP-date can require a longer wait, up to
60 seconds. A longer value ends request-level retries and leaves recovery to
the separate worker job-attempt policy. Permanent 4xx are not retried at the
request level. 403, 429, and challenge failures remain transient in the worker
classification. No partial metadata enrichment is committed first. Client IDs
are absent from safe errors and persisted diagnostics.

During collection, `import_jobs` progress stays `0/0`: membership requests are
not processed songs. Coverage and request counts remain runtime/CLI diagnostics,
not new durable `import_jobs` fields in this stage.

`sample_url` can be received with normal public metadata. It is neither used
to fetch a sample nor persisted; embedded lyrics, audio, recordings, profiles,
and comments still fail response validation.

Client IDs are never logged. Safety errors retain only the origin and path of a
request, not its query string.

## Sync lifecycle

1. Run the test suite.
2. Run a full dry-run against iSing and require `enrichment_status=complete`.
3. Confirm the target is Supabase DEVELOPMENT.
4. Enqueue the normal `import_jobs` write job through the platform-admin flow.
5. Run the existing import worker; do not re-enable the legacy direct-write CLI.
6. Verify DEVELOPMENT aggregates, Polish/duet coverage, and Song Discovery.

The current source is the live catalog at import time. Records absent from one
complete run are reported for later catalog-lifecycle work, not hard-deleted or
marked inactive by this stage.

## Development verification and future work

The pre-write and post-write checks include aggregate iSing coverage for
languages, duets, hits, Plus, duration, and genres, plus the canonical Polish
count. Participant Song Discovery is checked with default, language, duet, and
combined filters after the controlled DEVELOPMENT sync.

Future work may add precise non-Polish language mappings if iSing publishes
positive memberships, and a cross-vendor year/decade stage once both vendors
have an authoritative year contract.
