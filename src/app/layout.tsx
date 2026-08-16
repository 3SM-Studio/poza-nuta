import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { AppThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";
import "./(platform-admin)/admin/admin-theme.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Poza Nutą",
  description: "Nowa aplikacja Poza Nutą",
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html
      className={`${geist.variable} ${geistMono.variable}`}
      lang="pl"
      suppressHydrationWarning
    >
      <body>
        <AppThemeProvider>
          {children}
          <Toaster closeButton position="top-right" />
        </AppThemeProvider>
      </body>
    </html>
  );
}
