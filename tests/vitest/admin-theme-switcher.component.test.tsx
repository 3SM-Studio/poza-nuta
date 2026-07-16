// @vitest-environment jsdom

import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminThemeProvider } from "@/components/platform-admin/admin-theme-provider";
import { AdminThemeSwitcher } from "@/components/platform-admin/admin-theme-switcher";

const themeMock = vi.hoisted(() => ({
  theme: "dark" as string | undefined,
  setTheme: vi.fn(),
  throwOnRead: false,
  providerProps: null as Record<string, unknown> | null,
}));

vi.mock("next-themes", async () => {
  const React = await import("react");

  return {
    useTheme: () => ({
      get theme() {
        if (themeMock.throwOnRead) {
          throw new Error("theme read before mount");
        }
        return themeMock.theme;
      },
      setTheme: themeMock.setTheme,
    }),
    ThemeProvider: (props: Record<string, unknown>) => {
      themeMock.providerProps = props;
      return React.createElement(
        React.Fragment,
        null,
        props.children as ReactNode,
      );
    },
  };
});

describe("admin theme", () => {
  beforeEach(() => {
    themeMock.theme = "dark";
    themeMock.throwOnRead = false;
    themeMock.setTheme.mockReset();
    themeMock.providerProps = null;
  });

  it("does not read the selected theme during server rendering", () => {
    themeMock.throwOnRead = true;

    expect(() => renderToString(<AdminThemeSwitcher />)).not.toThrow();
  });

  it("offers dark, light and system choices after mount", async () => {
    render(<AdminThemeSwitcher />);

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
      const option = await screen.findByRole("menuitemradio", { name: label });
      fireEvent.click(option);
      expect(themeMock.setTheme).toHaveBeenLastCalledWith(value);

      if (value !== "system") {
        openThemeMenu(
          await screen.findByRole("button", { name: "Wybierz motyw" }),
        );
      }
    }
  });

  it("uses the accepted admin-only next-themes contract", () => {
    render(
      <AdminThemeProvider>
        <span>content</span>
      </AdminThemeProvider>,
    );

    expect(themeMock.providerProps).toMatchObject({
      attribute: "data-admin-theme",
      defaultTheme: "dark",
      enableSystem: true,
      enableColorScheme: false,
      storageKey: "pozanuta-admin-theme",
      disableTransitionOnChange: true,
    });
  });
});

function openThemeMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
}
