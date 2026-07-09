---
name: poza-nuta-shadcn-radix-ui
description: Use for shadcn/ui and Radix UI work in Poza Nutą: dashboard components, dialogs, dropdowns, cards, badges, forms and UI composition.
---

# Poza Nutą shadcn/Radix rules

Local UI components live in `src/components/ui`.
Do not import from a package named `shadcn`.

Allowed by default:
- Button, Card, Badge, Alert, DropdownMenu
- Dialog for non-destructive flows
- AlertDialog for destructive confirmations
- Input, Label, Textarea, Select, Separator, Avatar

Not allowed without approval:
- shadcn blocks
- sidebar blocks
- charts
- data-table demos
- calendar
- dark mode system
- generated demo pages

Rules:
1. No `window.confirm`.
2. Do not add dependencies without approval.
3. Keep existing theme/foundation unless task says otherwise.
4. Use Radix composition correctly.
5. Preserve keyboard navigation and focus handling.

Required report:
1. components used
2. shadcn MCP/docs consulted
3. accessibility notes
4. files touched
