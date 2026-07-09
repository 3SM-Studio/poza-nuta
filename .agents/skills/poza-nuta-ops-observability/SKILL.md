---
name: poza-nuta-ops-observability
description: Use for CI/CD, Vercel, preview deployments, logging, metrics, tracing, Sentry, backups, restore testing and migration rollback strategy in Poza Nutą.
---

# Poza Nutą ops/observability

Rules:
1. Do not change production env/deploy/domains without explicit approval.
2. Inspect logs safely; never print secrets.
3. Deployment checks must distinguish local/dev/staging/prod.
4. Migrations need rollback/forward-fix notes.
5. Backups are not real until restore has been tested.
6. Sentry setup should capture server/client errors without PII leakage.
7. Logging should identify route/action/result, not dump payloads.

Checklist:
- CI commands
- preview deployment behavior
- runtime logs
- Sentry error capture
- DB backup/restore
- migration rollback strategy
- env variable names, not values

Required report:
1. environment touched
2. external services accessed
3. mutations performed
4. rollback plan
5. observability gaps
