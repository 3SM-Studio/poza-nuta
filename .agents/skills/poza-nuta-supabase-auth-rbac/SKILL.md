---
name: poza-nuta-supabase-auth-rbac
description: Use for Supabase Auth, dashboard sessions, operator_users, workspace_members, platform_members, participant sessions, RLS and RBAC/ABAC decisions in Poza Nutą.
---

# Poza Nutą Supabase Auth/RBAC

Core model:
- `auth.users` = identity managed by Supabase.
- `operator_users` = local app profile linked by `auth_user_id`.
- `workspace_members` = organization membership and role.
- `platform_members` = platform-wide support/admin/owner.
- event assignments/hosts are event-specific permissions later.

Rules:
1. Supabase Auth proves identity; app DB decides business permissions.
2. Do not store workspace roles in `operator_users`.
3. Do not trust client-sent roles.
4. Dashboard API authorization must be server-side.
5. Browser Supabase client must not read business tables directly.
6. Avoid lockout: schema first, bootstrap owners second, enforce RBAC third.
7. Public participant sessions use HttpOnly cookies and hashed tokens.
8. Never print cookies, JWTs or env values.

Required report:
1. current auth/session flow touched
2. permission boundary
3. roles affected
4. lockout risk
5. tests/smoke required

## Email confirmation redirects

- Email confirmation must return through the application `/auth/callback` route.
- Production and localhost callback URLs must be explicitly allowed in Supabase Auth Redirect URLs.
- Custom Supabase email templates must preserve `RedirectTo` or use `ConfirmationURL`.
- Never construct confirmation links from `SiteURL` alone when a callback redirect is required.
- Auth redirect changes require a fresh signup confirmation smoke test. Unit tests alone are insufficient.
- Never expose authorization codes, access tokens or refresh tokens in logs.
