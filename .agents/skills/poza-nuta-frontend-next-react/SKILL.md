---
name: poza-nuta-frontend-next-react
description: Use for React/Next.js frontend changes in Poza Nutą: App Router, server/client boundaries, hydration, forms, loading/error/empty states, accessibility and performance.
---

# Poza Nutą frontend/Next rules

Rules:
1. Respect Server/Client Component boundaries.
2. No business authorization in UI only.
3. UI must handle loading, error and empty states.
4. Forms need validation and clear user feedback.
5. Destructive actions use confirmation UI, not `window.confirm`.
6. Keep mobile/responsive behavior.
7. Avoid hydration mismatches.
8. Browser must not read business tables directly from Supabase.
9. Prefer small component changes over redesigns mixed with backend logic.

Checklist:
- accessibility labels/keyboard behavior
- responsive state
- loading/error/empty state
- server/client boundary
- API contract compatibility
- no secrets/client data leaks

Required report:
1. screens/components touched
2. UX states covered
3. accessibility notes
4. smoke result
