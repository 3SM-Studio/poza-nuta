"use client";

import type { ComponentProps } from "react";
import { ThemeProvider } from "next-themes";
import { usePathname } from "next/navigation";

import { TooltipProvider } from "@/components/ui/tooltip";

export const APP_THEME_STORAGE_KEY = "pozanuta-admin-theme";

export function AppThemeProvider({
  children,
}: Pick<ComponentProps<typeof ThemeProvider>, "children">) {
  const pathname = usePathname() ?? "";
  const isParticipantExperience =
    pathname === "/join" ||
    pathname.startsWith("/join/") ||
    pathname.startsWith("/s/") ||
    pathname === "/visual-fixture/public-session";

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      storageKey={APP_THEME_STORAGE_KEY}
      disableTransitionOnChange
      forcedTheme={isParticipantExperience ? "dark" : undefined}
    >
      <TooltipProvider>{children}</TooltipProvider>
    </ThemeProvider>
  );
}
