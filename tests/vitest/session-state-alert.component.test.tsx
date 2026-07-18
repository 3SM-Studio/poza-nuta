// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  SessionStateAlert,
  type SessionStateAlertKind,
} from "@/components/public/session-state-alert";

describe("SessionStateAlert", () => {
  it.each([
    ["invalid", "Nieprawidłowy kod sesji"],
    ["scheduled", "Sesja jeszcze nieaktywna"],
    ["closed", "Sesja zakończona"],
    ["queue_disabled", "Kolejka wyłączona"],
    ["rate_limited", "Zbyt wiele prób"],
    ["canonical_unavailable", "Adres sesji niedostępny"],
    ["qr_unavailable", "Kod QR niedostępny"],
  ] satisfies [SessionStateAlertKind, string][])(
    "renders %s with an icon, title and description",
    (kind, title) => {
      render(<SessionStateAlert kind={kind} />);
      const alert = screen.getByRole("alert");

      expect(alert).toHaveAttribute("data-session-state", kind);
      expect(screen.getByText(title)).toBeVisible();
      expect(alert.querySelector("[data-slot='alert-description']")).not.toBeNull();
      expect(alert.querySelector("svg")).not.toBeNull();
    },
  );
});
