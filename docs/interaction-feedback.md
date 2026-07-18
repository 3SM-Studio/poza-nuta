# Interaction feedback

Poza Nutą uses one feedback primitive for each kind of information:

- **Inline error** belongs to a specific form field and explains how to fix it.
- **Alert** describes a persistent page state that remains relevant until the state changes.
- **Sonner** reports a short-lived result of a completed user action.
- **Badge** presents a readable status with text and, where useful, an icon and color.
- **AlertDialog** confirms a destructive or consequential action before it runs.
- **Progress or spinner** communicates an operation that is still running.

Do not show the same result simultaneously as an Alert and a toast. A toast must
not replace a persistent form error or a page state that the user needs to keep
visible.
