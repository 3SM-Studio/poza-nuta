// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { CloseEventConfirmation } from "@/components/operator/close-event-confirmation";
import { RequestStatusBadge } from "@/components/request-status-badge";
import { SessionQueueList } from "@/components/public/session-queue-list";
import { SessionQueuePanel } from "@/components/public/session-queue-panel";
import { SessionSearchResults } from "@/components/public/session-search-results";
import { LanguageSwitcher } from "@/components/language-switcher";
import { localeCookie } from "@/i18n/locale";
import messages from "@/i18n/messages/en.json";
import polish from "@/i18n/messages/pl.json";
import ukrainian from "@/i18n/messages/uk.json";
import sourceIndex from "@/i18n/source-index.json";
import { SessionStateAlert } from "@/components/public/session-state-alert";
import { PublicSessionLifecycle } from "@/components/public/public-session-lifecycle";
import { AppIntlProvider } from "@/i18n/app-intl-provider";
import { useUiText } from "@/i18n/use-ui-text";

const navigation = vi.hoisted(() => ({ refresh: vi.fn(), pathname: "/join" }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation, usePathname: () => navigation.pathname }));

describe("Participant translations", () => {
  it("opens one accessible cancellation confirmation in the mobile queue", () => {
    render(<SessionQueuePanel message={null} onOpenChange={vi.fn()} onRefresh={vi.fn()} open
      queue={null} refreshing={false} participantDisplayName="Synthetic singer" defaultTab="mine"
      cancelDialogRequestId="own-request" participantRequests={[{
        id: "own-request", title: "Original title", artist: "Original artist", status: "pending",
        queuePosition: null, isNext: false, canCancel: true, createdAt: "2026-10-16T12:00:00Z",
      }]} />);
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    expect(screen.getByRole("alertdialog")).toBeVisible();
  });
  it("keeps public EN and management PL fallbacks separate during client navigation", () => {
    function Draft() {
      const tx = useUiText();
      return <input aria-label={tx("Imię lub ksywka")} defaultValue="" />;
    }
    const view = () => <AppIntlProvider preferredLocale="en" managementLocale="pl" catalogs={{ en: messages, pl: polish }}><Draft /></AppIntlProvider>;
    navigation.pathname = "/join";
    const { rerender } = render(view());
    fireEvent.change(screen.getByLabelText("Name or nickname"), { target: { value: "Unchanged" } });
    navigation.pathname = "/sign-in";
    rerender(view());
    expect(screen.getByLabelText("Imię lub ksywka")).toHaveValue("Unchanged");
    expect(document.documentElement.lang).toBe("pl");
    navigation.pathname = "/join";
    rerender(view());
    expect(screen.getByLabelText("Name or nickname")).toHaveValue("Unchanged");
    expect(document.documentElement.lang).toBe("en");
  });
  it("changes UK public scope to EN management and back without resetting a mounted input", () => {
    function Draft() {
      const tx = useUiText();
      return <input aria-label={tx("Imię lub ksywka")} defaultValue="" />;
    }
    const view = () => <AppIntlProvider preferredLocale="uk" managementLocale="en" catalogs={{ uk: ukrainian, en: messages }}><Draft /></AppIntlProvider>;
    navigation.pathname = "/join";
    const { rerender } = render(view());
    fireEvent.change(screen.getByLabelText("Ім’я або нік"), { target: { value: "Незмінний нік" } });
    navigation.pathname = "/dashboard";
    rerender(view());
    expect(screen.getByLabelText("Name or nickname")).toHaveValue("Незмінний нік");
    expect(document.documentElement.lang).toBe("en");
    navigation.pathname = "/join";
    rerender(view());
    expect(screen.getByLabelText("Ім’я або нік")).toHaveValue("Незмінний нік");
    expect(document.documentElement.lang).toBe("uk");
  });
  it("offers Ukrainian publicly and omits it in management", () => {
    const publicRender = render(<NextIntlClientProvider locale="uk" messages={ukrainian} timeZone="Europe/Warsaw"><LanguageSwitcher /></NextIntlClientProvider>);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Мова інтерфейсу" }), { button: 0, ctrlKey: false, pointerType: "mouse" });
    expect(screen.getByRole("menuitemradio", { name: "Українська" })).toBeVisible();
    publicRender.unmount();
    render(<NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Warsaw"><LanguageSwitcher management /></NextIntlClientProvider>);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Interface language" }), { button: 0, ctrlKey: false, pointerType: "mouse" });
    expect(screen.queryByRole("menuitemradio", { name: "Українська" })).not.toBeInTheDocument();
  });
  it.each([
    ["invalid", "Nieprawidłowy kod sesji"], ["scheduled", "Sesja jeszcze nieaktywna"],
    ["closed", "Sesja zakończona"], ["queue_disabled", "Kolejka wyłączona"],
    ["rate_limited", "Zbyt wiele prób"], ["service_unavailable", "Sesja chwilowo niedostępna"],
    ["duplicate_request", "To zgłoszenie już czeka"], ["request_limit", "Masz już 2 aktywne zgłoszenia"],
    ["canonical_unavailable", "Adres sesji niedostępny"], ["qr_unavailable", "Kod QR niedostępny"],
  ] as const)("translates the %s API-code presentation in both languages", (kind, source) => {
    for (const [locale, catalog] of [["pl", polish], ["en", messages], ["uk", ukrainian]] as const) {
      const { unmount, container } = render(<NextIntlClientProvider locale={locale} messages={catalog} timeZone="Europe/Warsaw"><SessionStateAlert kind={kind} /></NextIntlClientProvider>);
      const key = sourceIndex[source];
      expect(container.querySelector(`[data-session-state="${kind}"]`)).toHaveTextContent(catalog.ui[key as keyof typeof catalog.ui]);
      unmount();
    }
  });

  it.each(["invalid", "scheduled", "closed", "cancelled", "rate_limited", "service_unavailable"] as const)("localizes the %s lifecycle and preserves the event name", kind => {
    render(<NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Warsaw"><PublicSessionLifecycle kind={kind} event={{ name: "Ustawienia", venue: "Wydarzenia", startsAt: "2099-10-16T12:00:00Z" }} /></NextIntlClientProvider>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ustawienia");
    expect(screen.getByText("Wydarzenia")).toBeVisible();
    expect(screen.getByRole("link", { name: "Enter the event code" })).toHaveAttribute("href", "/join");
  });
  it("preserves the distinction between an empty search and an error", () => {
    render(<NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Warsaw"><SessionSearchResults isLoading={false} message="Brak wyników. Spróbuj wpisać tytuł i wykonawcę." query="Ustawienia" songs={[]} onBack={vi.fn()} onSongSelect={vi.fn()} /></NextIntlClientProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("No results");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("heading")).toHaveTextContent("Ustawienia");
    expect(screen.getByRole("button", { name: "Back to catalog" })).toBeVisible();
  });
  it("translates status labels while retaining canonical statuses", () => {
    render(<NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Warsaw"><RequestStatusBadge status="approved" /><RequestStatusBadge status="now" /></NextIntlClientProvider>);
    expect(screen.getByText("Approved")).toHaveAttribute("data-request-status", "approved");
    expect(screen.getByText("In progress")).toHaveAttribute("data-request-status", "now");
  });

  it("keeps destructive confirmation cancellable without invoking its mutation", () => {
    const onCancel = vi.fn(), onConfirm = vi.fn();
    render(<NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Warsaw"><CloseEventConfirmation id="i18n-close" open isConfirming={false} onCancel={onCancel} onConfirm={onConfirm} /></NextIntlClientProvider>);
    expect(screen.getByRole("alertdialog")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows translated queue errors and keeps a retry action", () => {
    const onRefresh = vi.fn();
    render(<NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Warsaw"><SessionQueueList queue={null} message="Nie udało się wczytać kolejki." refreshing={false} onRefresh={onRefresh} /></NextIntlClientProvider>);
    expect(screen.getByRole("heading", { name: "Queue" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("sets only a locale preference and refreshes the existing route", () => {
    document.cookie = `${localeCookie}=; Max-Age=0; Path=/`;
    navigation.refresh.mockClear();
    render(<NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Warsaw"><LanguageSwitcher /></NextIntlClientProvider>);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Interface language" }), { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Polski" }));
    expect(document.cookie.includes(`${localeCookie}=pl`)).toBe(true);
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });
});
