---
name: poza-nuta-security-review
description: Use for security-sensitive work in Poza Nutą: OWASP, auth/session/cookies, RBAC/ABAC, RLS, rate limiting, CSRF/XSS, secret management and audit logs.
---

# Poza Nutą security review

Check:
- secrets in client bundle/logs/repo
- auth boundary and session verification
- server-side authorization
- RBAC/ABAC role escalation
- RLS policy correctness
- cookies: HttpOnly/SameSite/Secure where applicable
- CSRF/XSS for forms and mutations
- rate limiting for public endpoints
- audit logs for important mutations
- safe public errors

Forbidden:
- printing `.env`
- printing cookies/JWT/session tokens
- exposing service_role
- trusting client role flags
- broad public RLS policies without explicit justification
- destructive production actions

Required report:
1. blockers
2. high-risk issues
3. medium-risk issues
4. accepted residual risks
5. safe-to-ship verdict
