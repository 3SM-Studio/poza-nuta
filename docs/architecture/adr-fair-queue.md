# Slice 5: deterministic Fair Queue with operator control

Status: accepted for local implementation, 2026-10-16.

## Evidence and decision

The current queue uses `song_requests`, per-row versions, an event-session
`FOR NO KEY UPDATE` mutex (event-row fallback for legacy events), approved
positions and an operator audit log. Approval is already audited with an
event, request ID and server timestamp. `done` counts as a completed
performance in Slice 2, including the existing direct approved-to-done
operator action. Restore clears started/completed timestamps and returns a
request to pending. Starting another request implicitly completes `now`.
Slice 4 reassigns all requests to one canonical event participant without
copying history; aliases remain event scoped. Nicknames are labels only.

Keep those contracts. One pure engine in `src/server/fair-queue.ts` proposes
orders; one Drizzle adapter supplies a verified snapshot and persists it.
React and public APIs never calculate fairness. No migration is needed:
the existing approval audit provides a durable queue-entry timestamp. Do not
invent an `approvedAt` from a position update or use the browser clock.

## Mathematics and identity

For each approved request:

```
completed = number of distinct current done requests of its canonical owner
allocated = number of current now requests of that owner
ordinal = zero-based order among that owner's approved songs
waitCredit = other owners' done performances completed strictly after waitingSince
round = max(0, completed + allocated - waitCredit) + ordinal
```

Ordinals and ties use latest approval audit timestamp, then immutable request
ID. For legacy approved rows without an approval audit, use creation time
only as a deterministic tie anchor. The audit is not assumed complete:
historical direct inserts and fixtures can lack approval entries. Submission
time must not earn waiting credit for time spent pending. Until a verified
waiting anchor exists, waitingSince is null and waitCredit is zero. The next
successful Fair Insert or full sort records `event_queue_fair_anchor` for
each such approved row, timestamped at the server observation, in the same
transaction. Preview never writes/backfills an anchor. Future snapshots use
that anchor for waiting credit but keep creation time for deterministic ties.
This is an additive audit observation, not a claim about historical approval.
New/re-approved rows use their latest approval timestamp for both anchors,
so pending does not accumulate priority or consume an ordinal. Manual
reordering never resets either anchor. A fallback completed row without
`completedAt` counts as done, but earns no other request a waiting credit.

Without waiting credit this is the proposed completed + ordinal model, with
`now` reserving a performance. Each actual completion by somebody else while
waiting discounts one historical round, down to zero. Once zero is reached,
older approval wins against fresh arrivals of the same ordinal. Thus a finite
request with finite history and a known waiting anchor cannot be perpetually
displaced by new first songs while other performances continue. Legacy
approved rows acquire that anchor on the next successful fairness write.
There is no time/latency promise if
the operator pauses, manually moves it, never approves it, or repeatedly
restores/removes history. This is fair scheduling, not a hard reservation.

Tie key: round, ordinal, approval timestamp, request ID. Ordinal first breaks
equal rounds in favor of a participant's first queued song over somebody
else's second. For a full sort, each owner's songs retain approval order.
Exact input metadata always produces the same output, regardless of SQL row
order or current wall clock. Full sort is idempotent for unchanged data.

The DB adapter resolves event-scoped `mergedIntoId` before constructing owner
keys. A done request contributes once by request ID, including combined
history after merge. Credentials, device IDs, nicknames and Presence never
contribute identities or performance counts. A null participant FK gets its
own request-scoped legacy key: zero attributable history and no association
with another request with the same nickname. Manual participants with a real
membership use the same engine as public/operator/linked participants.

`hasPerformed`/first-time semantics remain unchanged: current now or done
means already appeared. For fairness, now is allocated but not completed.
Done-to-restore removes that request from completed history immediately;
pending, rejected and skipped do not count. This deliberately follows the
existing current-status model, not a new immutable performance ledger.
No history is deleted or rewritten to improve fairness.

## Soft adjacency constraint

Seed the previous owner from now (latest started timestamp, then ID), otherwise
the latest done (completed, started, creation timestamp fallback, then ID).
Repeatedly choose the earliest fair-key candidate with a different owner,
if available; otherwise choose the earliest candidate. This avoids adjacent
performances by one person even across round boundaries, but never blocks a
queue containing only that person. Unknown legacy rows are distinct owners;
the engine does not guess that identical nicknames mean the same singer.

## Fair Insert

Approval only inserts the newly approved request. Preserve the relative order
of every existing approved request, including manual decisions; never touch
now or any other status. The new song must follow all already approved songs
of the same owner. Evaluate available insertion slots deterministically:

1. Minimize the change in same-owner adjacent edges, including the now/last
   done boundary. Inserting between two consecutive same-owner songs repairs
   that edge when possible.
2. Minimize fair-key inversions involving the new song only.
3. Choose the earliest slot if still tied.

This is a constrained insertion, not a rebuild. A manual arrangement may
prevent the globally fairest order; existing decisions win. Positions are
renumbered to 1..N transactionally, incrementing versions only for changed
rows. The newly approved row already increments its version for the status
transition. Row numbers are ordering, not identities.

## Explicit full sort, preview and concurrency

Only an authorized active-event queue manager can preview or apply a sort.
POST preview returns current/proposed positions and a SHA-256 revision of
event-scoped request IDs/statuses/versions/positions/canonical owners/dates,
approval/waiting anchors and the latest fair-sort audit revision. It contains no
credential or global identity secrets. It is a concurrency token, not an
authorization capability. Preview performs no queue mutation.

POST apply accepts only that revision. Under the existing lifecycle guard
and queue mutex it reloads the snapshot, compares the revision and computes
the order again. A changed state returns 409 FAIR_QUEUE_PREVIEW_STALE with no
partial changes. The client cannot send a replacement order. Every successful
apply, including an unchanged order, records operator/event, before/after IDs,
timestamp and changed/unchanged outcome. The audit revision invalidates a
replayed preview even when no rows moved. Two identical concurrent applies
therefore cannot both apply one preview. A lost response is recovered by
refetching/previewing again, without silently reapplying an old order.

Lock order stays lifecycle -> event-session mutex -> request rows by ID.
There are no new membership/identity/credential locks and no external calls
under locks. Existing approve, move, start, done, restore, create and merge
use the same queue mutex. Merge's later identity/credential locks do not
create a reverse dependency from fair sort. Read the snapshot after acquiring
the mutex at READ COMMITTED. Viewer/cross-workspace/other-event/closed-event
requests fail server-side. Limits 2/2 and active-song duplicate checks remain
in the existing action service before insertion.

Only approved rows receive new positions/versions. Now and all pending,
rejected, done, skipped rows remain byte-for-byte unchanged during full sort.
Existing private Realtime triggers invalidate dashboard and public APIs after
commit; they never broadcast the preview, identities, audit payload or full
queue. Rollback emits no committed invalidation. No polling is added.

## UI and canonical responses

Add one focused preview/confirmation action to the current operator queue.
Keep the existing DnD/manual move mechanism. Show from/to positions, song and
singer in an accessible, scrollable dialog; handle loading, empty, unchanged,
network failure, stale preview, denied access and success. Stale data requires
a new preview, not automatic acceptance of a different proposal. Public views
only display persisted approved positions.

Approval responses include all canonical queue items, because insertion can
change other positions. The operator replaces its base snapshot with that
response and replays only still-pending local operations. Full sort is
serialized against local queue mutations; old refresh responses cannot
overwrite it. No separate fairness algorithm is added to optimistic UI.

## Alternatives, scope and risks

Strict completed-count/FIFO sorting permits starvation under continuing
arrivals. Rebuilding on every approval destroys manual decisions. Permanent
pin flags create another manual ordering subsystem. Random tie breaking makes
previews unreproducible. A new approval column/immutable performance ledger
would require a broader migration and change earlier slice semantics; existing
audits/current statuses suffice for this slice. Legacy attribution remains
explicitly limited. Event-sized snapshots and audit reads are proportional
to one local karaoke event, without external requests or long jobs.

The existing documentation mismatch about single versus multiple public active
events is recorded in Slice 1. This slice changes neither lifecycle nor that
scope: every operation remains explicitly event/workspace scoped. Driver
fault patch, migrations 0028–0030, participant sessions, Presence, linking,
rebranding, external songs, co-singers and autoapproval are outside changes.
