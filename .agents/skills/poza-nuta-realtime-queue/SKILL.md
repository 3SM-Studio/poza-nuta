---
name: poza-nuta-realtime-queue
description: Use for Supabase Realtime, WebSocket/SSE decisions, public/dashboard queue invalidation, realtime triggers and no-polling guarantees in Poza Nutą.
---

# Poza Nutą realtime queue

Architecture:
- Realtime is an invalidation signal only.
- Business data comes from Next API + Drizzle.
- Browser must not read `song_requests` directly.
- Do not use interval polling as the target queue mechanism.
- Preferred topic: `dashboard:event:{eventId}:queue`.

Rules:
1. Payload must be minimal: eventId, type, operation, changedAt.
2. No singer PII, cookies, tokens or full request payload in realtime.
3. Client receives broadcast and refetches API.
4. Refetch on subscribe/reconnect/focus is allowed.
5. `setInterval` queue polling is not allowed.
6. Dashboard channel should be private or otherwise authorized.

Acceptance:
- public submit appears in dashboard without manual refresh
- target latency < 2s, max 5s
- no direct browser business table reads
- test verifies no polling regression

Required report:
1. topic(s)
2. payload shape
3. auth model
4. smoke latency result
5. files touched
