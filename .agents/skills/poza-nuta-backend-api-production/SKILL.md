---
name: poza-nuta-backend-api-production
description: Use for Next Route Handlers and backend service work in Poza Nutą, including validation, transactions, idempotency, retries, queues/jobs, webhooks, email and safe errors.
---

# Poza Nutą backend/API production rules

Route handlers must be thin HTTP adapters:
1. parse/validate input
2. require session/authorization
3. call `src/server/*` domain service
4. map errors to safe responses
5. return typed JSON

Rules:
- business logic belongs in `src/server`, not UI or route handlers
- DB access is server-side through Drizzle
- multi-step mutations require transactions
- external calls need timeouts/retries/idempotency where relevant
- public endpoints need validation and rate limiting plan
- webhooks must verify signatures
- email sending is server-side only
- no secrets in logs

Required report:
1. endpoint/service changed
2. validation model
3. auth/permission check
4. transaction/idempotency behavior
5. tests
6. production risks
