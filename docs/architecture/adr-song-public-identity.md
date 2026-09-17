# ADR: Portable song identity

Status: Accepted.
Date: 2026-09-17.

## Decision

Each `songs` row is a source-specific karaoke rendition. Its bigint `id` remains the local database identity and the target of `song_requests.song_id`. Its UUID v4 `public_id` is the stable, portable identity for future playlist, API, export and import formats. The database generates it for new songs. Import upserts must preserve it, and restore/import workflows must carry the original UUID rather than regenerate it.

This milestone adds no canonical-song layer. Canonicalization can be considered separately if the product later needs to group renditions across sources. Request and queue contracts continue using bigint song IDs.

## Consequences

The rollout has three separately controlled phases:

1. Migration 0025 adds a **nullable** UUID column and its database default. Existing songs retain NULL at this point.
2. A separate, resumable command backfills existing NULL rows in bounded transactions and verifies the remaining count.
3. A future milestone verifies live data, adds uniqueness, and enforces `NOT NULL`. Only then is the portable identity contract complete.

The split follows a local 92,014-song benchmark in which a single migration transaction blocked `SELECT`, `INSERT`, and `UPDATE` for about 5.2 seconds. The existing `(source, source_song_id)` identity still drives KaraFun and iSing upserts. `public_id` must remain immutable at the domain level even though phase A adds no database trigger. Future portable formats must reference `public_id`; local foreign keys remain bigint.
