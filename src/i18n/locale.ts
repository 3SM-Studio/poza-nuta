export const locales = ["pl", "en", "uk"] as const;
export type Locale = (typeof locales)[number];
export const localeCookie = "kunestu_locale";
export const defaultLocale: Locale = "en";
export const managementDefaultLocale: Locale = "pl";

export function isLocale(value: unknown): value is Locale {
  return locales.some(locale => locale === value);
}

export function resolveLocale(cookie: string | undefined, acceptLanguage: string | null, fallback: Locale = defaultLocale): Locale {
  if (isLocale(cookie)) return cookie;
  const preferences = (acceptLanguage ?? "").split(",").map((part, index) => {
    const [tag, ...parameters] = part.trim().toLowerCase().split(";");
    const quality = parameters.find(parameter => parameter.trim().startsWith("q="));
    const weight = quality === undefined ? 1 : Number(quality.trim().slice(2));
    return { language: tag.split("-")[0], weight, index };
  }).filter(item => Number.isFinite(item.weight) && item.weight > 0 && item.weight <= 1)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const preference of preferences) if (isLocale(preference.language)) return preference.language;
  return fallback;
}

// Ukrainian currently covers the public participant experience. Preserve the
// device's public preference while using a complete EN catalog for management.
export function resolveUiLocale(cookie: string | undefined, acceptLanguage: string | null, management: boolean): Locale {
  const locale = resolveLocale(cookie, acceptLanguage, management ? managementDefaultLocale : defaultLocale);
  return management && locale === "uk" ? "en" : locale;
}

export function isManagementPath(pathname: string): boolean {
  return ["/dashboard", "/admin", "/account"].some(path => pathname === path || pathname.startsWith(`${path}/`))
    || ["/sign-in", "/sign-up", "/setup", "/auth/invite/accept"].includes(pathname);
}
