---
name: poza-nuta-testing-strategy
description: Use when planning or changing tests in Poza Nutą: unit, integration, E2E Playwright, contract tests, migration tests and smoke checks.
---

# Poza Nutą testing strategy

Testing layers:
- unit: pure helpers and validation
- integration: server services with mocked/controlled DB boundary
- API contract: route inputs/outputs/statuses
- migration: SQL safety and read-only verification
- E2E Playwright: public and dashboard user flows
- smoke: runtime checks after migrations/auth/realtime changes

Rules:
1. Do not fake success with snapshots only.
2. Auth, RBAC and migration changes require negative-path tests.
3. Browser smoke must not print credentials, cookies, tokens or localStorage.
4. Destructive UI flows test open/cancel unless explicitly approved.
5. For realtime, test no manual refresh and no interval polling.
6. For API, test validation, authorization and safe error mapping.

Required report:
1. test level chosen
2. tests added/changed
3. commands run
4. gaps that remain
5. smoke result
