// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  APP_THEME_STORAGE_KEY,
  AppThemeProvider,
} from "@/components/theme-provider";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Toaster } from "@/components/ui/sonner";

describe("global application theme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
  });

  afterEach(() => {
    document.documentElement.className = "";
  });

  it("does not read the selected theme during server rendering", () => {
    expect(() => renderToString(<ThemeSwitcher managementTheme />)).not.toThrow();
    expect(() =>
      renderToString(
        <AppThemeProvider>
          <Toaster />
        </AppThemeProvider>,
      ),
    ).not.toThrow();
  });

  it("offers global dark, light and system choices", async () => {
    renderTheme();

    const trigger = await screen.findByRole("button", { name: "Wybierz motyw" });
    await waitFor(() => expect(trigger).not.toBeDisabled());
    openThemeMenu(trigger);
    expect(await screen.findByRole("menu")).toHaveAttribute(
      "data-management-theme",
      "true",
    );

    for (const [label, value] of [
      ["Ciemny", "dark"],
      ["Jasny", "light"],
      ["Systemowy", "system"],
    ] as const) {
      fireEvent.click(
        await screen.findByRole("menuitemradio", { name: label }),
      );
      await waitFor(() =>
        expect(window.localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe(value),
      );

      if (value !== "system") {
        openThemeMenu(
          await screen.findByRole("button", { name: "Wybierz motyw" }),
        );
      }
    }
  });

  it("restores the saved global preference after remount", async () => {
    const firstRender = renderTheme();
    const trigger = await screen.findByRole("button", { name: "Wybierz motyw" });
    await waitFor(() => expect(trigger).not.toBeDisabled());
    openThemeMenu(trigger);
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "Jasny" }),
    );
    await waitFor(() =>
      expect(window.localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe("light"),
    );

    firstRender.unmount();
    document.documentElement.className = "";
    renderTheme();
    openThemeMenu(
      await screen.findByRole("button", { name: "Wybierz motyw" }),
    );

    expect(
      await screen.findByRole("menuitemradio", { name: "Jasny" }),
    ).toHaveAttribute("data-state", "checked");
    expect(document.documentElement).toHaveClass("light");
  });

  it("mounts one class-based provider at the root and none in route layouts", () => {
    const rootLayout = readSource("src/app/layout.tsx");
    const adminLayout = readSource("src/app/(platform-admin)/admin/layout.tsx");
    const dashboardLayout = readSource("src/app/dashboard/layout.tsx");
    const accountLayout = readSource("src/app/account/layout.tsx");
    const operatorLayout = readSource(
      "src/components/operator/operator-app-layout.tsx",
    );
    const provider = readSource("src/components/theme-provider.tsx");
    const publicHeader = readSource(
      "src/components/public/public-site-header.tsx",
    );
    const siteHeader = readSource("src/components/app-shell/site-header.tsx");

    expect(rootLayout.match(/<AppThemeProvider>/g)).toHaveLength(1);
    expect(rootLayout.match(/<Toaster\b/g)).toHaveLength(1);
    expect(adminLayout).not.toContain("ThemeProvider");
    expect(dashboardLayout).not.toContain("ThemeProvider");
    expect(accountLayout).not.toContain("ThemeProvider");
    expect(adminLayout).not.toContain("Toaster");
    expect(dashboardLayout).not.toContain("Toaster");
    expect(accountLayout).not.toContain("Toaster");
    expect(provider).toContain('attribute="class"');
    expect(provider).toContain('defaultTheme="dark"');
    expect(provider).toContain("enableSystem");
    expect(provider).toContain("disableTransitionOnChange");
    expect(provider).toContain('"pozanuta-admin-theme"');
    expect(rootLayout).toContain("suppressHydrationWarning");
    expect(publicHeader.match(/<ThemeSwitcher/g)).toHaveLength(1);
    expect(siteHeader.match(/<ThemeSwitcher/g)).toHaveLength(1);
    expect(adminLayout).toContain('data-management-theme="true"');
    expect(operatorLayout).toContain('data-management-theme="true"');
    expect(adminLayout).toContain('className="bg-sidebar text-foreground"');
    expect(operatorLayout).toContain(
      'className="bg-sidebar text-foreground"',
    );
  });
});

function renderTheme() {
  return render(
    <AppThemeProvider>
      <ThemeSwitcher managementTheme />
    </AppThemeProvider>,
  );
}

function openThemeMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
}

function readSource(relativePath: string) {
  return readFileSync(`${process.cwd()}/${relativePath}`, "utf8");
}
