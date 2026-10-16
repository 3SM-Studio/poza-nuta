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
      // The bootstrap executes while parsing SSR HTML. React never executes
      // inline scripts created on client remounts; represent those as inert data.
      // next-themes effects still apply stored/system/forced themes normally.
      scriptProps={{ type: typeof window === "undefined" ? "text/javascript" : "application/json" }}
    >
      <TooltipProvider>{children}</TooltipProvider>
    </ThemeProvider>
  );
}
