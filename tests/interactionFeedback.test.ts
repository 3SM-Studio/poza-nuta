import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("interaction feedback policy assigns one primitive to each purpose", () => {
  const policy = readFileSync("docs/interaction-feedback.md", "utf8");

  for (const primitive of [
    "Inline error",
    "Alert",
    "Sonner",
    "Badge",
    "AlertDialog",
    "Progress or spinner",
  ]) {
    assert.match(policy, new RegExp(`\\*\\*${primitive}`));
  }

  assert.match(policy, /Do not show the same result simultaneously/);
  assert.match(policy, /must\s+not replace a persistent form error/);
});

test("feedback integrations preserve field errors and use transient action toasts", () => {
  const sessionForm = source("src/components/public/session-code-form.tsx");
  const sessionRequest = source(
    "src/components/public/session-request-page.tsx",
  );
  const accessPanel = source(
    "src/components/operator/event-session-access-panel.tsx",
  );
  const eventSettings = source("src/components/operator/event-settings.tsx");
  const imports = source(
    "src/components/platform-admin/admin-imports-panel.tsx",
  );

  assert.doesNotMatch(sessionForm, /from "sonner"/);
  assert.match(sessionForm, /session-code-error/);
  assert.match(sessionRequest, /toast\.success\("Dodano zgłoszenie"/);
  assert.match(sessionRequest, /toast\.error\("Nie udało się dodać zgłoszenia"/);
  assert.match(accessPanel, /toast\.success\(message\)/);
  assert.match(eventSettings, /toast\.success\("Ustawienia wydarzenia/);
  assert.match(imports, /toast\.success\("Gotowe"/);
  assert.match(imports, /toast\.error\("Operacja nieudana"/);
});

function source(path: string) {
  return readFileSync(path, "utf8");
}
