"use client";

import type { ComponentProps } from "react";
import { ThemeProvider } from "next-themes";

import { TooltipProvider } from "@/components/ui/tooltip";

export const APP_THEME_STORAGE_KEY = "pozanuta-admin-theme";

export function AppThemeProvider({
  children,
}: Pick<ComponentProps<typeof ThemeProvider>, "children">) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      storageKey={APP_THEME_STORAGE_KEY}
      disableTransitionOnChange
    >
      <TooltipProvider>{children}</TooltipProvider>
    </ThemeProvider>
  );
}
