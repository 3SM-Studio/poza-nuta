---
name: poza-nuta-architecture-review
description: Use for architecture decisions in Poza Nutą: domain model, API contracts, event lifecycle, permission model, multi-tenant/workspace design and ADRs.
---

# Poza Nutą architecture review

Current principles:
- MVP backend stays inside Next.js App Router API routes.
- Route handlers are thin adapters.
- Business logic stays in `src/server`.
- DB schema/access stays in `src/db`.
- Supabase Auth is identity only.
- Workspace membership controls business roles.
- Supabase Realtime is invalidation, not data API.
- Browser does not read business tables directly.

Review:
1. Does this match the roadmap?
2. Is this a domain model change or only implementation detail?
3. What hidden assumptions exist?
4. What becomes harder later?
5. Is multi-tenant/workspace scope respected?
6. Is API contract stable?
7. Is Fastify extraction later still feasible?

Required report:
1. facts
2. assumptions
3. risks
4. better alternatives
5. recommended decision
6. ADR/roadmap update needed
