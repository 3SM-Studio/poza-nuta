-- Receive invalidations only for events in an active organization membership.
-- Reuse the reviewed topic-aware membership helper; no new grants or write policy.
ALTER POLICY "active operators can receive dashboard queue broadcasts"
ON "realtime"."messages"
USING (
  extension = 'broadcast'
  AND (SELECT realtime.topic()) ~ '^dashboard:event:[0-9]+:queue$'
  AND private.can_receive_event_participants(
    regexp_replace((SELECT realtime.topic()), ':queue$', ':participants')
  )
);
