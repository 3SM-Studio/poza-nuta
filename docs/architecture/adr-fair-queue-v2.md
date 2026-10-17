# Fair Queue v2 and confirmed participant history

Date: 2026-10-17. Status: implemented for isolated evaluation; production activation is not authorised. Complements the queue collaboration ADR and preserves the `legacy` engine as the default and rollback option.

## Evidence and alternatives

The previous engine subtracts an unbounded waiting credit from completed rounds. A returning singer can eventually obtain the same effective round as a newcomer. Removing that credit gives conventional least-served fair-share scheduling, but continuous first-song arrivals can indefinitely postpone second songs. Neither rule alone establishes all the desired product properties.

`scripts/simulate-fair-queue.ts` compares these two rules with a hybrid on identical exogenous admissions and synthetic service slots. The committed comparison includes censored requests, first/later waits and protection sensitivity. It does **not** demonstrate a universally best strategy: the hybrid improves some first-song waits in the finite workload and reduces proposal churn, but worsens some maximum/later waits. Served-only averages conceal the fair-share starvation example. There is no authorised event #46 export or available project-scoped connector; no historical replay or claim about the actual decisions at that event is made.

Recommended conservative candidate: preserve real completed rounds, add a separately explained protection lane after an observed admission-roster cycle, and keep activation explicit. One cycle is a product policy, not a statistically optimal constant. Half/double-cycle sensitivity is reported. Event-specific service-time prediction, inferred song duration and speculative human behaviour are excluded.

## Deterministic selection

Identity is the canonical event participant ID, never nickname. A legacy request without that ID owns only itself. Known merge aliases resolve to the canonical membership. Each owner's approved requests are FIFO by latest real approval timestamp, then immutable request ID. Unknown approval history uses creation time only as a stable ordering fallback; it grants no historical waiting credit.

For an eligible owner's head, define:

- `C`: confirmed completed performances in this event;
- `N`: currently allocated `now` performances;
- `j`: zero-based ordinal of the owner's approved song;
- ordinary round `R = C + N + j`;
- `B`: distinct other approved/now identities observed at admission, minimum one;
- `T`: confirmed foreign completions strictly after the later of the real waiting anchor and the owner's latest dated completion or later observation of an undated own completion.

The recorded admission budget is frozen; a stream of newcomers does not continually enlarge it. Reapproval starts a new admission. Existing unbudgeted approved requests receive an explicitly labelled observation on the next authorised queue write. Missing approval times receive an observation anchor then, never a fabricated historical acceptance time. A read-only preview uses a deterministic current-roster fallback until that observation exists.

An eligible head is protected when it has a known waiting anchor and `T >= B`. Protected heads precede ordinary heads and tie by approval time/ID. Ordinary heads compare `(R, j, approval time, ID)`. True completion counts are never reduced. The public multiplier is fixed at one; the pure simulation parameter is used only for sensitivity experiments.

Only the first queued song of each identity competes at each step. If the selected identity equals the previous performer and another identity is available, take the first such alternative. Seed the previous performer from `now`, otherwise the latest dated confirmation with request-ID/index tie-breakers. `now` itself never moves. Subsequent proposal steps allocate approved songs without inventing future completions or future waiting credit.

The protection bound is **conditional**: after B observed foreign completions the head enters protection. New later admissions cannot displace earlier protected heads forever when the earlier protected backlog is finite; separation may require an intervening other performer. This is not a wall-clock SLA or an unconditional guarantee under arbitrary manual moves, cancellations, event closure, unknown history or admission rates above service capacity. Several earlier songs of the same owner must still finish first.

## Insert, sort and explanations

Fair Insert derives the full proposal preference, then chooses the legal insertion slot with the fewest inversions involving the new song. A new admission cannot be inserted ahead of any already protected initial owner head, even when the preserved existing order opposes the full-sort ranking. This hard floor prevents continuous arrivals from exploiting an inversion tie and repeatedly bypassing protection. All existing approved pairs remain unchanged, including manual decisions; a new song stays behind existing songs of its identity. Equal-cost slots prefer the earlier slot. These hard constraints can prevent the globally preferred position and even perfect separation. The response/audit explicitly marks a constrained insertion. Its explanation describes the policy preference subject to preserving manual order, not a promise to reorder existing songs.

Fair Sort is an explicit whole-queue action: preview, cancel or apply with exact snapshot hash. The hash includes the selected engine, durable history and admission data, row versions and the last sort revision. Changed source data or engine rejects stale apply. Apply uses the existing event mutex/transaction and creates the collaboration sort barrier even for a no-op. Local pending intentions must resolve before a whole-queue sort. Manual DnD remains a deliberate override.

No browser time, random value, nickname, input-array order or song duration determines output. Generated tests cover permutations, owner FIFO, stable re-sorting and avoidable adjacency. Sorting uses owner heads; database presentation uses batched event-scoped reads rather than per-card requests. The synthetic engine benchmark is separate from browser responsiveness.

## Performance facts and cancellation

New explicit `done` and the existing deliberate start-next operation append `event_queue_performance_completed` in the same transaction. Start-next retains its existing behaviour of finishing the previous `now`; its provenance is `implicit_next_start`, not inferred elapsed time. Starting alone is not a completion.

The existing `restore` action now also offers a separately confirmed **cancel performance** for `now`: return to pending, clear running timestamps and record `event_queue_performance_cancelled`, without adding a completion. Source semantic CAS protects it from concurrent start/done. Undoing a completed request does not erase the observed performance. A legacy `done` first restored under this release gets an explicit `legacy_done_observed_before_restore` observation, preserving its count. An unknown completion time remains unknown and grants no foreign-turn credit. Re-performing a restored request can produce another real confirmation; idempotent UUID retries cannot duplicate it.

The shared `performance-history.ts` reader also consumes original `event_queue_done` actions, so a historical restore does not turn a known returning singer into a newcomer. New confirmation/action pairs deduplicate by request version (`requestVersion` / `nextVersion`), not timestamps or nicknames. An old restore whose audit explicitly says its source was `done` proves an otherwise unrecorded implicit completion; its date stays unknown. The observation timestamp is a conservative waiting anchor, never a fabricated performance timestamp. Both the operator statistics and v2 consume this same projection. A current legacy `done` with no recorded completion is observed once before restoring.

No past renamed names or unsupported hidden performances are reconstructed. Records whose original state/audit evidence is missing cannot receive invented history. `hasPerformed` retains its old status-based API meaning; the operator's first-performance label now uses the new confirmed completion count. Participants with `now` but zero confirmed completions still have an unfinished first performance.

## Identity and conflict boundaries

Current event nickname is a presentation projection. Stored request display/singer snapshots remain immutable. Migration 0033 audits only future actual name changes, with event-scoped private before/after values. It increments the canonical stream revision and sends minimal invalidation, never names or participant payloads. It does not increment request semantic intent versions. Therefore both operators fetch new names while a structurally unchanged drag and pending local intents remain valid. Merge changes ownership and therefore fairness; existing merge consent/RBAC/locking and sort-staleness rules remain authoritative.

Realtime continues to be invalidation, not a trusted business data transport. Canonical snapshots, receipts, independent writes, gap recovery and durable outbox behaviour remain the collaboration protocol. The read model supplies current name, original request name, actual rename audit, confirmed count and known merged history; legacy unlinked rows are not guessed by text matching.

## Migration, rollout and rollback

0032 must precede 0033. 0033 adds a restricted trigger function and trigger only; no domain-data rewrite, backfill, index replacement or new required column. Fresh PG17 and an upgrade from the prior schema are covered by disposable integration fixtures. Function uses a fixed empty search path and revoked browser-role execution. Audit, revision and broadcasts roll back with the name transaction.

For any future authorised release: first backup/restore verification and migration-history/hash validation; apply additive 0032/0033 before code; verify grants, actual rename/no-op behaviour and event isolation. No existing environment was migrated by this integration task. No domain/URL changes are required.

`KUNESTU_FAIR_QUEUE_ENGINE=legacy` is the default. Select `rotation-v2` only after the owner reviews the fairness tradeoff and approves deployment. Changing it invalidates outstanding previews. Roll back the engine to `legacy` and/or the previous application without deleting confirmations, receipts, snapshots or migration history. Legacy scheduling intentionally uses its original status-based mathematics, so it does not acquire all v2 history guarantees. An older application does not provide the new confirmed-history UI or collaboration safety contract. Do not run destructive down migrations; a broken trigger needs an explicitly reviewed forward fix. Production compatibility and rollout remain a separate approval gate.

Simulation execution is explicit: full-sort-each-turn compares global scheduling preferences; stable-insert separately models normal automatic insertion without repeatedly applying Fair Sort. Each strategy sees the same exogenous arrivals within its model. Waiting is admission to start of service, not end of the song. Synthetic service durations are used only to advance the model clock. Engine-only load uses at most two active songs per identity; 1000 rows means 500 synthetic identities and does not establish a 1000-card browser/DB SLA.
