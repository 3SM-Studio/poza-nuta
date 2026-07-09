---
name: poza-nuta-db-migration-review
description: Use for every Drizzle/Postgres schema or migration change in Poza Nutą, especially NOT NULL columns, backfills, FKs, unique indexes, RLS, triggers and realtime SQL.
---

# Poza Nutą DB migration review

Use before writing or accepting any migration.

Rules:
1. Never hide domain-critical foreign keys behind DB defaults unless explicitly approved.
2. For existing tables: add nullable column, backfill, verify, then SET NOT NULL.
3. Add FKs only after data is valid.
4. Replace indexes safely; prefer `DROP INDEX IF EXISTS` for dev/staging drift.
5. For unique partial indexes, verify the predicate matches the business rule.
6. For trigger/function changes, verify payload contains no secrets or oversized data.
7. All runtime inserts must be updated in code before migration is accepted.
8. Do not run production migrations without explicit approval.

Checklist:
- changed objects
- existing data backfill
- NOT NULL/FK safety
- index replacement
- runtime insert/update paths
- rollback difficulty
- read-only verification queries
- smoke required

Required report:
1. migration files reviewed
2. risk level
3. blockers
4. exact verification queries
5. safe-to-migrate DEV verdict
