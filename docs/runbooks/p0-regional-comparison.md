# P0: controlled regional comparison — plan only

Date: 2026-10-18. Owner decision: no deployments, including Preview. None of the commands below has been executed. Production project, domains, aliases, environment variables and database remain unchanged.

## Owner update during local verification

The owner reports independently deploying the existing production SHA `6c6d3f884a1e26919d98db75b816bb19f3c58344` to fra1, READY deployment `dpl_5HewkFw9SnJ4dBNV1WyX2cXAPVWP`. Do not redeploy or change regions. The earlier iad1 inspection below is historical. A safe production verification plan now takes precedence over the unexecuted Preview experiment. Any write test requires a quiet-window check and separate owner authorization; it is not authorized by a region-status message.

## Evidence and decision

Read-only Vercel inspection confirms production deployment `dpl_4YxXwaAFhks3tDs1HLEQ5KKwJzCH` is READY in `iad1`. The historical release SHA is `6c6d3f884a1e26919d98db75b816bb19f3c58344`; the candidate derives from local checkpoint `fa9b9b0f9c9219005996c1980ab8386ec7d04d5c`. Supabase location in the retained incident evidence is `eu-central-1`. CDN edge location is not evidence of function placement.

Existing Preview entries in the inspected deployment list use older commits, not this candidate. Sensitive Preview DATABASE_URL is unreadable; encrypted URL metadata did not establish a separate database. Never assume Preview means isolated. No existing Preview was invoked and no regional test was deployed. Therefore there is no actual paired iad1/fra1 p50/p95/p99 or production peer-convergence result. Local delayed-wire data cannot fill that gap.

## Minimal prospective configuration

Vercel supports deployment-specific region selection using `--regions`; project configuration also supports `regions`. A future authorized single-region candidate could add only:

```json
{"regions":["fra1"]}
```

This is an illustration, not an active repository configuration. Do not change Production settings or commit an active regional switch before approval and measurements. Do not use both regions in one routing pool as the A/B test: requests must have a known execution region. Do not add automatic failover; availability depends on the plan and automatic failover is not a measured rollback strategy.

Sources checked 2026-10-18: [Vercel region configuration](https://vercel.com/docs/functions/configuring-functions/region), [region identifiers](https://vercel.com/docs/regions). The current region page specifies one region on Hobby, five on Pro and all on Enterprise; verify the actual team's plan and current pricing before any future experiment. Two deployments can still create two sets of pools and cold starts. No paid plan or spend is authorized here.

## Preconditions for any later experiment

1. Obtain separate authorization to deploy. Current answer is NO; stop here until changed.
2. Establish a dedicated nonproduction EU PostgreSQL 17/Supabase project with synthetic catalog, organizations, operators and events. Confirm DB endpoint reference equals Auth/Realtime reference and differs from `qwmimnhdnzqfckswxjww`; verify identity read-only before writes. Never copy Auth/participant data or credentials from production.
3. Supply isolated DATABASE_URL, public Supabase URL/publishable key, site/callback URLs, setup/invitation/admin/worker secrets and flags. Scrub inherited Production/Preview env files. Disable external email/import workers and real invitations. Existing hidden Preview variables are not acceptable evidence. Stop if isolation cannot be proven.
4. Build the same finalized SHA, lockfile, Node version, flags, database snapshot/statistics/indexes, function size and pool settings twice. Use explicit iad1/fra1 deployment-specific selection, never global project mutations. No alias/domain/DNS operations. Do not promote either experiment.
5. Use protected deployment URLs, isolated Auth callbacks and two synthetic browser accounts. Confirm returned deployment function regions and log correlation, not just an edge header. Preview protection overhead must be consistent and reported separately.

## Measurement protocol and budgets

Collect at least 100 warm operations per placement/approve/start/done/snapshot in each region, interleaving regional runs; report cold start separately. Use 20/50/100 requests, concurrent independent/conflicting operators, same client locations and the same data/reset policy. Sample p50/p95/p99 with nearest-rank definition and raw samples; p99 at n=100 is a noisy tail estimate. Report spread, counts, failures and confidence limitations; no cherry-picking successful requests.

Measure new TCP/TLS startup separately from warm parameterized `SELECT 1`. That SQL round-trip includes server/driver time and is not pure network RTT. Record actual SQL statement/message counts and pipelining; multiplied SQL count is only a model, not direct latency attribution. Existing transaction-attempt-to-start includes pool checkout plus BEGIN/wire time. Existing FOR UPDATE span includes wire, execution and lock wait; do not label it a pure mutex measurement. In the isolated database use PostgreSQL plans/buffers and wait samples to separate execution and blocking; do not log bind values. Separate transaction body and commit-return interval, HTTP server span, browser request/ack, validated Realtime revision signal, authorized snapshot and next rendered frame.

The server logs request_id and operation_id; protected snapshots tie committed revision to origin request/operation. Both browser reports expose only bounded semantic records. Cross-device Date.now clocks are not synchronized: use the test coordinator's monotonic clock for gesture-to-peer-visible latency, and browser-local clocks for local intervals. Coalesced intermediate revisions do not imply each intermediate arrangement was displayed. A report with pending intents is not convergence.

Budgets: native local UI p95 <=100 ms at 20/50/100; local peer p95 <2 s and max <=5 s. Regional production-like peer visibility must satisfy the agreed p95/max bounds, and no functional, authorization, ranking or persistence regressions are permitted. No regional GO can be inferred before those measurements. Include connection pressure under the Free database limit, cold-start pool multiplication, cross-region bandwidth and actual plan pricing; costs are not quantified without that evidence.

## Future release and rollback, not executed

After paired evidence and separate owner approval, release the chosen candidate to the existing `pozanuta` project and existing `https://pozanuta.vercel.app` URL. No manual aliases/domains/DNS actions. Capture the previous READY deployment and its environment/region first. If errors, lost receipts, unexpected authorization, or peer latency breaches occur, stop synthetic traffic and use an authorized standard Vercel rollback to that READY deployment. It keeps existing assigned URLs; never delete domain mappings. A previous iad1 deployment is the rollback target for a fra1 candidate. Keep compatible database schema and receipts; no destructive database rollback. Legacy search fallback is a separate, explicitly approved environment change, never an implicit side effect. No migrations are required by this final-mile candidate.
