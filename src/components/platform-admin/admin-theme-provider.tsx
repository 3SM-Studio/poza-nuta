"use client";

import type { ComponentProps } from "react";
import { ThemeProvider } from "next-themes";

export function AdminThemeProvider({
  children,
}: Pick<ComponentProps<typeof ThemeProvider>, "children">) {
  return (
    <ThemeProvider
      attribute="data-admin-theme"
      defaultTheme="dark"
      enableSystem
      enableColorScheme={false}
      storageKey="pozanuta-admin-theme"
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
