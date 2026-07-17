import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppThemeProvider } from "@/components/theme-provider";

import "./globals.css";
import "./(platform-admin)/admin/admin-theme.css";

export const metadata: Metadata = {
  title: "Poza Nutą",
  description: "Nowa aplikacja Poza Nutą",
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="pl" suppressHydrationWarning>
      <body>
        <AppThemeProvider>{children}</AppThemeProvider>
      </body>
    </html>
  );
}
