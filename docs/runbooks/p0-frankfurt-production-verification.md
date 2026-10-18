# Frankfurt production verification — prepared, not authorized for writes

2026-10-18 owner update: existing production code `6c6d3f884a1e26919d98db75b816bb19f3c58344`, deployment `dpl_5HewkFw9SnJ4dBNV1WyX2cXAPVWP`, READY/fra1. This is an owner statement until checked through deployment metadata and function runtime logs. No redeployment, region/env changes, migrations, aliases, DNS, restart or suspend/resume is part of this procedure.

## Read-only preflight

1. Inspect this exact deployment via authenticated Vercel metadata; confirm project `pozanuta`, Production, SHA, region, READY and existing URL assignment. Runtime `VERCEL_REGION` log correlation is execution evidence; a CDN `x-vercel-id` alone is not enough.
2. Filter Vercel logs for this deployment since its creation. Export only semantic request/operation classes, HTTP status, durations, DB failure classes and aggregate counts. Never export full session paths, search text, cookies, tokens, SQL bind values, names or IPs. Supabase logs must be read-only and aggregated; no new production logging configuration.
3. Using verified qwmimnhdnzqfckswxjww connection, explicitly BEGIN READ ONLY and verify transaction_read_only=on before queries. A startup default is not sufficient through this pooler. Read bounded counts for currently active karaoke, participant connections, now/approved/pending real requests, worker/import activity, long transactions, blockers and connection pressure. No SELECT that invokes application lazy-closing helpers. Do not read/print private row data. A quiet-window count is point-in-time, not a lock preventing new activity.
4. Verify available operator access without creating users or changing Auth. Do not execute legacy release/smoke scripts: they may perform old migrations, suspend or mutate real resources.

If authenticated tools/credentials are unavailable, report the exact unavailable evidence. Do not substitute user-provided READY with a measured function-region claim, and do not infer isolation from a project name. Preserve existing encrypted credentials; no secret values in prompts or logs.

## Separate write authorization gate — STOP

Before any writes, present preflight counts and ask the owner to approve a specific quiet window and bounded controlled test below. Existing approval for an earlier release is not permission for this test. Active real karaoke, unverified scope, a missing privacy flag or no separate approval means STOP. Do not restart services to obtain measurements.

## Proposed controlled run after approval

Use one new, clearly marked PRIVATE test event in the existing verified organization, with only synthetic names and catalog references, no public join advertising, emails or invitations. Confirm public discovery/queue/session exposure is disabled and existing single-active-public-event semantics are respected. Record its IDs in a private local allowlist; refuse every mutation outside that allowlist. Two existing authorized operator browser sessions use this event only. Never clear/reorder actual events. If private event isolation cannot be demonstrated, do not proceed.

Before seeding, preserve aggregate baseline counters for real events; after the run compare real-event revisions/counters, allowing genuine concurrent activity to be classified rather than silently attributed. A test event must not invalidate real-event channels. Stop on any out-of-scope target or unexpected public exposure. Do not delete test audit/receipts; close only the synthetic event after separate authorized cleanup intent. Do not rotate production keys or create broad administrator grants.

Run a low-rate sequence with no burst/load generator: 100 warm sample operations per requested scenario, no more than one mutation in flight globally except the specifically bounded two-operator conflict test. Cap total mutation count and duration in the approval. Prepare 20/50/100 synthetic requests with distinct synthetic participant identities or valid ownership rules; preserve 2/2. Placement alternates a source between adjacent neighbours. Separate approve, start and done cycles; start requires an empty synthetic stage or the expected synthetic current performance. Critical confirmations remain visible. A finite, pre-approved warm-up is reported separately. Stop if p95/server errors worsen, DB pressure rises, or real karaoke starts.

Measure click-to-local-RAF, HTTP ack and peer-visible canonical order/revision from the same coordinator's monotonic clock. Report p50/p95/p99, min/max, counts, errors and raw numeric samples for each operation type and queue size. A missing receipt/revision is a failure, not an omitted sample. Browser clock Date.now is not a synchronized cross-device clock. Vercel server logs/SQL spans in 6c6d3f8 may be coarser than local candidate telemetry; do not deploy new code just to fill those gaps. Record exactly which DB/pool/mutex/commit components remain inseparable.

Search uses a small predeclared set of nonpersonal public catalog queries; keep phrases out of logs and reports. Record safe query-shape labels, status, latency and classified57014, with low request rate. No broad EXPLAIN ANALYZE on production or arbitrary long query, no timeout increase and no stats reset. Successful bounded queries do not prove that the unidentified old timeout is fixed.

## Comparison and decision

Historical iad1 evidence is not a paired benchmark: production logs concern 6c6d3f8 but may reflect different warmness, traffic and queries; fa9 loopback/delayed-wire tests concern a different candidate and are not iad1 cloud measurements. Compare only matched shapes, timestamps/code SHA and operation classes; report missing p50/p95/p99 as unavailable. Estimate regional improvement only where a defensible before/after sample exists. Never compute a claimed percentage speedup from unrelated cohorts.

The UI optimization addresses synchronous React work independent of network location: a faster DB region cannot remove the measured 408-card render work. Whether backend round-trip optimizations are necessary to meet the actual fra1 budget must be measured; fewer statements are not by themselves proof of end-to-end improvement. A region change may reduce protocol wait without fixing expensive SQL. Preserve uncertainty about57014 until matched evidence or detailed safe spans establish its cause.

Acceptance: local UI p95<=100ms, peer p95<2s/max<=5s under the agreed production-like operation mix; no silent conflict overwrite, lost durable intent, unauthorized access, changed real-event queues or repeated57014. Passing functional tests alone is not performance GO. If the controlled run cannot be authorized or isolation cannot be proven, outcome is NOT MEASURED/BLOCKED for that gate, not a fabricated PASS.
