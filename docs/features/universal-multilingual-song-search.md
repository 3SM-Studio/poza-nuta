# Universal multilingual song search

Date: 2026-10-16.

| Scope | Verdict | Meaning |
| --- | --- | --- |
| P0: original-script Unicode search | PASS locally | Required scripts, canonical/fold equivalence, ranking, PL/EN/UK browser equality, search-to-request flow and limits verified on the explicit unicode-v2 engine. |
| P1: cross-script alternatives | PARTIAL | Private, provenance-bearing alias foundation and six reviewed fixture aliases pass. General-purpose language-specific transliteration and broad provider aliases are not implemented or claimed. |
| P2: PL/EN fuzzy quality and performance | PARTIAL | Existing human-query and adversarial quality suites pass on v2. Mixed-script 100,000-row measurements expose broad-query cost and English-query overhead; real provider recall, paired latency measurements and an agreed deployment latency budget remain unverified. |

The verified local optimized server used explicit `SONG_SEARCH_ENGINE=unicode-v2`. The repository default remains `legacy` until a separately approved migration/backfill/cutover. This is not a production activation or production-readiness claim. Local P0 handoff: GO within the tested scope. Remote cutover: NO-GO pending the runbook gates and separate owner approval.

Branch `feat/kunestu-participant-model-fair-queue`, preserved HEAD `721a1dd35caec0666d099024a344628c6e075c1c`. No commit, stage, push or deployment. Prior i18n, Enterprise DnD, stopped infrastructure work, artifacts and private configuration are preserved. The task-start manifest hashes 806 existing files. It is the original comparison boundary; the separately saved diff was refreshed during implementation and must not be treated as an exact task-start snapshot.

## Audit and cause

`src/lib/song-search.ts` still contained `replace(/[^a-z0-9\s]/g, ' ')` and removed every Unicode Mark. Both provider importers persisted its lossy normalized title, artist and search text. Existing tests explicitly asserted that Cyrillic/Greek normalized to empty. Public validation and client gating required two characters; operator catalog input also imposed a two-character HTML minimum. Search used the same catalog service across public and operator paths; session browse independently filtered the old search_text.

Consequences: changing the query alone cannot restore missing persisted data; global diacritic removal erases meaningful non-Latin vowels/points; trigram patterns with no extractable trigrams can degenerate into full-index scans. The existing 50-item pagination and bounded candidate window are retained. Provider rendition identity `(source, source_song_id)`, bigint IDs and public UUIDs are not canonicalized or regenerated.

## Architecture and normalization

See `docs/architecture/adr-unicode-song-search.md`.

- NFKD compatibility normalization; Unicode 17 full default case folding, excluding locale-specific Turkic mappings; canonical decomposition.
- Remove accent marks only following Latin bases; explicit Latin ł/ø/đ and æ/œ mappings. Preserve non-Latin marks, joiners, letters and numbers.
- Strip bidi formatting controls from keys; punctuation/emoji become separators. Original title/artist text is retained byte-for-byte in songs and returned unchanged.
- SQL normalization is generated from the same pinned fold table, Unicode 17 scalar decompositions and character-class ranges. This avoids relying on database locale lowercasing or a global unaccent dictionary. Unicode data license is included.
- The application must have the verified Unicode 17 runtime. Unknown engines or a mismatched runtime fail before a Unicode search. The generator also verifies its Unicode release.
- Search input and original title/artist presentation use `dir=auto`; this does not change the page locale or domain data.

Do not equate preserving letters with proven natural-language tokenization for every language. The tested original-script path is literal, canonical and deterministic. It does not perform semantic translation, stemming, script conversion or global accent stripping.

## Retrieval, ranking and pagination

Maximum input: 100 UTF-16 code units before normalization. Reject runs of 17 combining marks. A meaningful query needs two letters/numbers, or one Han/kana/Hangul character. Whitespace tokenization is capped at 16 distinct useful tokens; unspaced CJK/Thai/etc. use literal substring matching.

Single numeric tokens are retained inside multiword queries (including non-ASCII numbers). Omitting them could broaden `song 1` to all `song` matches. The legacy tokenizer is kept separately for rollback. Extremely expanded internal keys are defensively bounded before retrieval.

GIN arrays contain adjacent non-space code-point bigrams and CJK unigrams. Candidate containment is followed by literal rechecking, so matching separate characters does not establish a substring match. Queries without useful grams use exact identity/alias retrieval only, preventing an empty-array full-index scan. Fuzzy matching is enabled only for Latin/Cyrillic/Greek queries with useful grams and at least three non-space code points. No global fuzzy strategy is imposed on Arabic, Hebrew, Indic, CJK or Thai.

Ranking tiers: combined identity 1200, exact title 1100, exact artist 1000, combined prefix 900, title prefix 850, artist prefix 825, identity tokens 750, identity substring 650, document substring 500, reviewed alias exact/prefix/substring 450/400/350, fuzzy fallback 300. Similarity and stable C-collated artist/title/source/id break ties. Original-script exact matches therefore outrank transliterated aliases. Fuzzy fill remains bounded and is suppressed when at least 100 strong candidates exist.

Candidate limits: 500 exact-title + 500 exact-artist + 500 literal + 200 alias + 200 fuzzy, deduplicated before final ranking. SQL transaction statement timeout is 2 seconds. The public result page has at most 50 items. Opaque cursor v2 binds normalized query and engine version; malformed/mismatched cursors are rejected. Cursor bounds account for NFD/UTF-8 expansion (8 KiB encoded, 1,200 code units per sort key). Switching engines invalidates pending search cursors; restart search at page one, without changing session URLs or identity.

Search pagination covers the bounded candidate window, as before. It does not promise exhaustive enumeration of 100,000 broad matches; use ordinary catalog browsing for traversal. Very long provider titles/artist keys beyond the cursor bound and oversized B-tree keys require a preflight and a later index/cursor design, not silent truncation.

## Aliases and P1 boundary

`song_search_aliases` stores a rendition FK, title/artist/combined kind, original alternate spelling and required provenance. A trigger derives its normalized key and grams. There is no public write endpoint and no unreviewed transliterator.

Verified synthetic aliases: Okean Elzy → Океан Ельзи, Kino → Кино, Amr Diab → عمرو دياب, Zhou Jielun → 周杰伦, Utada Hikaru → 宇多田ヒカル, BTS → 방탄소년단. These are explicit fixture records, not proof that arbitrary kanji can be romanized or that every name has one correct spelling. Further pinyin/romaji/Arabic/Korean variants need trusted source aliases and language review. Hebrew points, Arabic vowel/letter variants and Greek accents are preserved unless a reviewed alias intentionally supplies an alternative.

## Endpoints and imports

Existing URLs, HTTP response shape, public request IDs, tokens, QR, song names and session capabilities remain unchanged. Shared service changes affect public song search, token-session song search and operator participant-catalog search. Session song browse with q now selects the Unicode projection when enabled; browse filtering/sorting/cursor contracts remain intact. Route handlers keep authorization/rate limiting and validation.

| Existing endpoint | Integration |
| --- | --- |
| `/api/public/songs/search` | Shared validation and catalog service; existing public access controls. |
| `/api/session/[code]/songs/search` | Same engine after existing session-code/capability checks. |
| `/api/s/[token]/songs/search` | Same engine after existing token-session/capability checks. |
| `/api/s/[token]/songs/browse` | Unicode projection predicate for `q`; existing filters and browse ordering. |
| `/api/dashboard/organizations/[organizationId]/events/[eventId]/participants/songs` | Same engine after existing dashboard authorization and organization/event scope checks. |

iSing and KaraFun mapping explicitly retain the old normalizer for legacy columns. Migration 0031's source-table trigger maintains the new projection for inserts/upserts/updates regardless of importer or engine flag. No second independent job is required to index a successful import, and a failed transaction rolls back both source and projection. The existing job/CLI contracts and provider identities remain unchanged. Non-Latin subtitle metadata lost in old search_text cannot be reconstructed if it was never retained; P0 title/artist keys are recovered from originals. Provider reimport is a separate operation.

## Migration and local actions

Migration: `drizzle/0031_unicode_song_search.sql`, snapshot `0031_snapshot.json`, journal index 31. It creates only two derived tables, indexes and helper/trigger functions. Existing table models are unchanged. Both new tables have RLS, no browser policies, revoked anon/authenticated access. Helper functions have public execution revoked. SECURITY DEFINER trigger functions have a fixed pg_catalog search path and qualified table/function references; they cannot be called as public RPC utilities.

No eager existing-catalog rewrite occurs in the migration. The backfill inserts only missing version-2 documents, with source-row locks, SKIP LOCKED, bounded transactions and idempotent reruns. It preserves source rows, all IDs, legacy keys and aliases. The local CLI accepts only an owned loopback database target, before constructing the client; no dotenv/cloud override is accepted. It verifies PostgreSQL 17 and reports missing rows after the loop, including rows skipped because another transaction held a lock.

Actual local actions: verified PostgreSQL 17.6 on the owned development stack at loopback port 55522 and checked all 31 existing migration hashes/timestamps. Applied only pending migration 0031 there, backfilled 20 synthetic existing renditions, added 15 multilingual synthetic renditions and six reviewed aliases. Missing projection rows: zero. Browser attempts created new synthetic participants/Presence; the final extended run also created exactly two requests belonging to its new UK participant. No prior request/participant was edited or deleted, and failed-trial synthetic records were retained. No environment files were edited. Current local launcher accepts the explicit search-engine flag. No production/Preview/remote database or service was contacted.

## Tests and evidence

Final verification:

- `pnpm test`: 414 Node and 679 Vitest PASS, zero failures/skips.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: PASS; optimized Next.js 16.3 build. Typecheck repeated after final test additions. The extra two-test-file lint command exited without errors but explicitly ignored both files under the existing ESLint configuration; it is not evidence that those files were linted. No ignore rules were weakened.
- `git diff --check`: PASS after whitespace correction, repeated after report completion.
- Unicode PostgreSQL 17 integration: PASS, including the final mixed-script scale run and actual full-query plans.
- Existing search quality + SQL/API/UI integration: two suites PASS in legacy mode; human-query quality + SQL/API/UI + adversarial ranking/pagination: three suites PASS with unicode-v2 enabled.
- Separate real PostgreSQL cancellation test: PASS. A 20 ms statement timeout cancels pg_sleep with SQLSTATE 57014, rolls back, and the patched Postgres.js pool serves three subsequent Unicode searches. A restricted NOLOGIN importer role inserts a song through RLS/INSERT permission; the fixed-path trigger creates its projection while direct helper RPC permission remains denied. No production/import-worker role was created or modified.
- Optimized-build browser: nine scenario groups PASS, including 18 queries per PL/EN/UK context (54 searches), identical result ID order, original titles, RTL, one-character CJK, absent-title state and Unicode browse. UK uses Chromium iPhone 13 touch emulation; PL/EN use desktop viewport. Native physical touch/IME is not claimed. Chromium 149.0.7827.55.
- Browser API negatives: overlong query 400, wildcard-only query empty, SQL-syntax input equivalent to its normalized plain-text query, invalid token 404, unauthenticated operator catalog 401. Authenticated operator Unicode search passes.
- The new UK participant selects and requests Arabic and Japanese originals, receives Ukrainian success feedback and a real localized API 2/2 rejection for a third song. Zero browser page/runtime errors and zero external requests.

- Unit normalization: Latin accents, full folding, every requested alphabet, canonical equivalence, meaningful non-Latin marks, CJK threshold, script-sensitive fuzzy gating, wildcard/control/length/mark abuse, legacy rollback and runtime mismatch.
- Owned disposable PostgreSQL 17.10: 61 top-five original-script cases, six aliases, 13,452 JS/SQL normalization/gram parity cases including all non-Hangul scalar NFKD changes and their decompositions. Additive migration, source preservation, resumed/idempotent backfill, trigger/upsert freshness, transaction rollback, alias/original ranking, negative privileges and two-page cursor stability passed.
- Existing PL/EN quality/API/UI suites pass in legacy mode; expanded run also exercises the existing human-query quality corpus, SQL/API/component path and adversarial ranking/pagination on v2.
- Negative CLI test confirms unknown target rejection without a database socket or credential output.

Artifacts: `.artifacts/unicode-search-{unit,postgres,legacy-postgres,v2-quality}.log`, `unicode-search-postgres-result.json`, `unicode-search-local-preflight.json`, `unicode-search-local-preparation.json`, final gate logs and browser evidence. Earlier failed test attempts concerned Result-array prototype comparison, an obsolete last-migration assertion, an extensionless Node import, a stale cursor-version test helper and a misleading use-prefixed non-React function name. They were corrected without skipping assertions or suppressing errors. No migration failed.

Final evidence also includes `unicode-search-postgres-final.log`, `unicode-search-timeout.log`, `unicode-search-browser-final.log`, `unicode-search-browser-result.json` and RTL/CJK screenshots. The first browser security assertion incorrectly assumed that a SQL-looking string could never have legitimate normalized text matches; it now checks equality with the equivalent plain query. Its fragment hits also exposed omitted single-digit tokens, corrected with an explicit tokenizer regression. This was not evidence of SQL execution. Intermediate failed logs remain, and are not final PASS evidence.

### Final recovery audit

This recovery changed documentation only. Re-read the saved result files and final log tails; did not rerun the 100,000-row benchmark, migrations or browser writes. Runtime source modification times precede the saved final build (2026-10-16 14:34:18 UTC). Later changes were the browser test, separate timeout integration/configuration and documentation; those two tests have their own subsequent successful execution logs. Modification times support this comparison but are not historical source-content hashes. A new recovery evidence manifest records current SHA-256 hashes of task files and retained evidence for future comparisons.

The task-start comparison confirms no removed files and no changes outside the scoped search manifest. Earlier i18n catalogs, DnD implementation, Fair Queue core and private configuration retain their task-start hashes; earlier incomplete infrastructure work was neither resumed nor removed. Git index remains empty. This establishes preservation of earlier work, not a fresh full DnD/i18n infrastructure certification.

Audit conclusions: parameters remain bound through Drizzle, LIKE metacharacters are escaped, candidate/page/token/input limits are enforced, and query transactions have a 2-second statement timeout. No business authorization or identity code changed. Fixed-path trigger functions keep derived writes in the source transaction, and source-row locks prevent backfill from publishing an older source version over a concurrent edit. Resumption fills missing version-2 rows only; it is not a general repair of existing stale/corrupt documents. Standard rollback therefore keeps triggers enabled. There is no new interval polling or Realtime payload and no change to request status, session identity or Fair Queue mathematics.

The retained negative browser evidence covers invalid session and unauthenticated operator access; it does not replace a fresh exhaustive cross-organization RBAC or full Realtime reconnect suite. Existing full unit/component tests passed, and unchanged source boundaries plus focused search browser tests support the regression assessment. Native IME, physical-device and real-provider tests remain explicitly outstanding.

| Script/feature | Evidence and boundary |
| --- | --- |
| Latin, Cyrillic, Greek | Original-script fixtures and browser queries; Latin accent folding and scoped typo fallback. Greek marks retained. |
| Arabic, Hebrew | Original-script fixtures, meaningful marks retained, RTL presentation; no general letter/vowel-variant equivalence claimed. |
| Devanagari, Thai | Original-script fixtures and browser queries; literal continuous-text matching, no linguistic stemming. |
| Han, Japanese kana/kanji, Hangul | Original-script fixtures and browser queries; one-character CJK cases and indexed rare-character retrieval. No inferred pinyin/romaji. |
| Other Unicode letters/numbers | Normalizer retains Unicode 17 classes; this is not language-by-language end-to-end coverage. |
| Aliases | Six explicit reviewed fixture aliases; originals outrank aliases. No provider-wide alias coverage. |

## Performance methodology and measured limits

Windows host: Ryzen 7 5700X3D, 16 logical processors, approximately 32 GiB RAM; Node 24.19.0 / ICU 78.3 / Unicode 17; Docker PostgreSQL 17.10. Isolated corpus: 100,000 synthetic scale renditions plus multilingual/edge fixtures. Half of scale rows add Han/Cyrillic/Arabic/Thai/Hangul artist text, with 10,000 Han-character matches and an independent rare-character case. No local provider catalog CSV was available. Source files/data directory were not modified or fetched from a production service.

Measurements include the complete application search transaction from Node. Each query has one warm-up and seven sequential timed samples; median and empirical p95 (the maximum of seven) are reported. A single legacy call on the same corpus is a reference, not a statistically equivalent baseline. Unsupported legacy Cyrillic/CJK queries are not valid latency comparisons. The scale insertion/index/trigger path took 106.39 seconds; this is bulk-load cost, not search latency.

| Query | v2 median ms | v2 sample p95 ms | legacy single ms |
| --- | ---: | ---: | ---: |
| Gorniak | 10.01 | 11.41 | 13.76 |
| Dancing Queen | 22.56 | 26.13 | 14.77 |
| dancin queen | 23.78 | 25.25 | 15.22 |
| Кино | 9.64 | 10.23 | unsupported original-script/short search |
| عمرو دياب | 15.16 | 16.33 | unsupported original-script/short search |
| 周 | 83.48 | 92.24 | unsupported original-script/short search |
| 光 | 7.93 | 10.18 | unsupported original-script/short search |
| ab | 7.98 | 8.75 | 150.54 |
| fi | 51.19 | 53.15 | 935.70 |
| Fixture Song 90000 | 621.02 | 634.19 | 929.68 |
| unrelatedzzzxxyy | 12.03 | 13.44 | 14.53 |

Twenty concurrent searches alternating Han `周` and Latin `Gorniak` completed without errors in 490.76 ms. Eight concurrent expensive Latin searches completed in 2715.82 ms with identical result IDs across all eight responses; a separate repeated Cyrillic query was also deterministic. These are batch completion times, not per-request p95s. Full generated-query EXPLAIN ANALYZE/BUFFERS plans (with all parameters still bound) are saved for 周, 光 and fi. The rare 光 plan uses the GIN grams index. Common 周 and fi plans legitimately choose sequential scans for their broad literal branches, with indexed exact-identity lookups and PK joins; no planner settings were forced. A tiny alias table also uses sequential scans. The measured 621 ms broad/fuzzy-fill case is a real cost. The two measured English song/typo medians are around 23 ms versus a single legacy reference around 15 ms; do not call that a statistically proven speedup or hide the absolute overhead. No claim of production throughput, Internet latency or identical performance for every distribution is made.

## Rollout preflight and rollback

The separate [migration/backfill/rollback runbook](../runbooks/unicode-song-search-rollout.md) is a proposal for later approval. These are preparation instructions, not authorization to modify any remote service.

1. Identify and approve an isolated deployment target and database. Record backup/restore evidence and existing migration hashes. Keep engine legacy. Verify actual application Unicode version 17.0, PostgreSQL 17, UTF-8, pg_trgm, application/import roles and permissions.
2. Review 0031, its generated constants, table/index sizes and trigger write amplification. Apply it through the migration journal in the approved environment. It creates indexes on empty derived tables; do not replace this with drizzle-kit push or a source-table rewrite.
3. Run batched backfill on the approved target. The supplied developer CLI intentionally refuses production/Preview; any remote runner needs separate authorization and equivalent target guards. Measure progress/import coexistence and validate projection completeness/normalization before cutover. Re-run safely after interrupted/locked batches.
4. Validate source IDs/content/legacy keys, aliases/provenance, worst-case normalized key lengths, DB-role SELECT access and restricted importer trigger behavior. No grants to browser roles. Check plans and real catalog quality/load on that target.
5. Enable SONG_SEARCH_ENGINE=unicode-v2 only after those checks. Re-run session capability/RBAC tests and PL/EN/UK public search against the same data. Pending search cursors must restart; participant sessions and existing requests remain.
6. On regression, return reads to legacy and restart/refetch searches. Keep additive tables/functions, source records and aliases. This preserves all IDs and rollback data. Trigger overhead remains. Disabling/removing triggers requires a separate approved forward-fix and reconciliation plan: the supplied missing-only backfill does not repair existing documents changed while triggers were disabled. Never delete/reset songs or rewrite source titles for rollback.

Read-only verification SQL:

```sql
SELECT current_setting('server_version_num'), current_setting('server_encoding');
SELECT count(*) AS missing FROM songs s WHERE NOT EXISTS (
  SELECT 1 FROM song_search_documents d WHERE d.song_id=s.id AND d.normalization_version=2
);
SELECT max(octet_length(normalized_title)), max(octet_length(normalized_artist))
FROM song_search_documents;
SELECT count(*) FROM song_search_documents d JOIN songs s ON s.id=d.song_id
WHERE d.normalized_title <> public.kunestu_search_normalize_v2(s.title)
   OR d.normalized_artist <> public.kunestu_search_normalize_v2(s.artist);
SELECT relname, relrowsecurity FROM pg_class
WHERE oid IN ('song_search_documents'::regclass,'song_search_aliases'::regclass);
SELECT has_table_privilege('anon','song_search_documents','SELECT'),
       has_function_privilege('anon','kunestu_search_normalize_v2(text)','EXECUTE');
```

## Remaining verification and boundaries

No real provider-catalog coverage/availability, production/Preview rollout, physical phone/tablet, Safari/iOS IME or native screen reader is verified here. Browser touch emulation must be labelled as such. No claim that a missing provider song proves search failure, or that a coincidental fuzzy hit proves romanization. A real approved catalog snapshot and native-language review remain required for provider recall and further aliases. Complete worldwide language-specific fuzzy/transliteration behavior is outside P0.

Manual checks: scan the unchanged QR on independent PL/EN/UK devices; type Arabic/Hebrew RTL and mixed-script queries, use native Japanese/Chinese/Korean IMEs without premature search, search one Han character, compare identical result order, open original song details, and verify existing identity/2/2/Realtime flows. Run only in an explicitly approved isolated environment.

Tools used: local Git/PowerShell/Node/pnpm, Docker-owned PostgreSQL 17, Drizzle, Vitest and Playwright/Chromium; Context7 for Drizzle documentation and web reads of Unicode/PostgreSQL primary references. No Supabase, Vercel, GitHub or other remote administrative MCP was used.

## Task file list

43 files differ from the task-start manifest, including the separate rollout runbook added during final recovery. No starting file was removed; private Codex configuration is unchanged. Changes to existing dirty UI/launcher/test files preserve the earlier work and add only the scoped search integration.

- `.env.example`
- `drizzle/meta/_journal.json`
- `src/components/operator/event-participants-panel.tsx`
- `src/components/public/session-search-results.tsx`
- `src/components/public/session-shell-header.tsx`
- `src/components/public/session-song-row.tsx`
- `src/components/public/song-details-drawer.tsx`
- `src/components/public/validation.ts`
- `src/db/ising-mapping.ts`
- `src/db/karafun-mapping.ts`
- `src/db/schema.ts`
- `src/lib/song-search-cursor.ts`
- `src/lib/song-search.ts`
- `src/server/public-api/validation.ts`
- `src/server/session-api/service.ts`
- `src/server/song-search.ts`
- `tests/participantLinkingMigration.test.ts`
- `tests/postgres/songSearchAdversarial.review.test.ts`
- `tests/postgres/songSearchQuality.integration.test.ts`
- `tests/postgres/songSearchSqlApiUi.integration.test.tsx`
- `tests/publicClientValidation.test.ts`
- `tests/vitest/song-search.test.ts`
- `docs/architecture/adr-unicode-song-search.md`
- `docs/features/universal-multilingual-song-search.md`
- `docs/runbooks/unicode-song-search-rollout.md`
- `drizzle/0031_unicode_song_search.sql`
- `drizzle/meta/0031_snapshot.json`
- `scripts/backfill-unicode-song-search.ts`
- `scripts/generate-unicode-search-sql.ts`
- `scripts/local-next.ts`
- `src/db/song-search-backfill.ts`
- `src/lib/UNICODE-LICENSE.txt`
- `src/lib/song-search-engine.ts`
- `src/lib/unicode-case-fold.json`
- `src/server/song-search-unicode.ts`
- `tests/e2e/unicode-song-search.local-smoke.mjs`
- `tests/fixtures/unicode-song-search.ts`
- `tests/localToolIsolation.test.ts`
- `tests/postgres/unicodeSearchTimeout.integration.test.ts`
- `tests/postgres/unicodeSongSearch.integration.test.ts`
- `tests/unicodeSongSearchMigration.test.ts`
- `vitest.song-search-unicode-quality.config.ts`
- `vitest.unicode-search-postgres.config.ts`
