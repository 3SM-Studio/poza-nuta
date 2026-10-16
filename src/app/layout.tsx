import { getUiText } from "@/i18n/server";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { getLocale } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { AppIntlProvider } from "@/i18n/app-intl-provider";
import { localeCookie, resolveLocale, resolveUiLocale } from "@/i18n/locale";

import { VercelInsights } from "@/components/observability/vercel-insights";
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

export async function generateMetadata(): Promise<Metadata> {
  const tx = await getUiText();
  return {
  title: "Poza Nutą",
  description: tx("Poza Nutą — dołącz do karaoke, wybierz piosenkę i obserwuj kolejkę na żywo."),
};
}

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function RootLayout({ children }: RootLayoutProps) {
  const locale = await getLocale();
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  const preferredLocale = resolveLocale(cookieStore.get(localeCookie)?.value, requestHeaders.get("accept-language"));
  const managementLocale = resolveUiLocale(cookieStore.get(localeCookie)?.value, requestHeaders.get("accept-language"), true);
  const messages = (await import(`../i18n/messages/${preferredLocale}.json`)).default;
  const catalogs = preferredLocale !== managementLocale
    ? { [preferredLocale]: messages, [managementLocale]: (await import(`../i18n/messages/${managementLocale}.json`)).default }
    : { [preferredLocale]: messages };
  return (
    <html
      className={`${geist.variable} ${geistMono.variable}`}
      lang={locale}
      suppressHydrationWarning
    >
      <body>
        <AppIntlProvider preferredLocale={preferredLocale} managementLocale={managementLocale} catalogs={catalogs}>
        <AppThemeProvider>
          {children}
          <Toaster closeButton position="top-right" />
        </AppThemeProvider>
        </AppIntlProvider>
        {process.env.KUNESTU_LOCAL !== "1" && <VercelInsights />}
      </body>
    </html>
  );
}
