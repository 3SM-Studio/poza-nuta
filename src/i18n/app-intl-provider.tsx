"use client";

import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { isManagementPath, type Locale } from "./locale";

// Root layouts persist during client navigation. Resolve scope here as well as
// on the server so a public UK preference cannot leak into an EN-only dashboard.
export function AppIntlProvider({ preferredLocale, managementLocale, catalogs, children }: {
  preferredLocale: Locale;
  managementLocale: Locale;
  catalogs: Partial<Record<Locale, AbstractIntlMessages>>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const locale = isManagementPath(pathname ?? "/") ? managementLocale : preferredLocale;
  const messages = catalogs[locale];
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  if (!messages) throw new Error("Required interface locale catalog is unavailable.");
  return <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Warsaw">{children}</NextIntlClientProvider>;
}
