"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { isLocale, localeCookie } from "@/i18n/locale";

export function LanguageSwitcher({ management = false }: { management?: boolean }) {
  const locale = useLocale();
  const t = useTranslations("ui");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="sm" className="min-h-11 gap-1.5" aria-label={t("language")} disabled={pending}>
        <Languages aria-hidden="true" className="size-4" /><span>{locale.toUpperCase()}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuRadioGroup value={locale} onValueChange={value => {
        if (!isLocale(value) || (management && value === "uk") || value === locale) return;
        startTransition(() => {
          document.cookie = `${localeCookie}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
          router.refresh();
        });
      }}>
        <DropdownMenuRadioItem value="pl" lang="pl">Polski</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="en" lang="en">English</DropdownMenuRadioItem>
        {!management ? <DropdownMenuRadioItem value="uk" lang="uk">Українська</DropdownMenuRadioItem> : null}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
