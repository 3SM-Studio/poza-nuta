"use client";

import { useSyncExternalStore } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const themeOptions = [
  { value: "dark", label: "Ciemny", icon: MoonIcon },
  { value: "light", label: "Jasny", icon: SunIcon },
  { value: "system", label: "Systemowy", icon: MonitorIcon },
] as const;

type AdminTheme = (typeof themeOptions)[number]["value"];

export function AdminThemeSwitcher() {
  const themeContext = useTheme();
  const mounted = useSyncExternalStore(
    subscribeToMountState,
    getClientMountState,
    getServerMountState,
  );

  if (!mounted) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label="Wybierz motyw"
        title="Wybierz motyw"
        disabled
      >
        <MonitorIcon />
      </Button>
    );
  }

  const selectedTheme = isAdminTheme(themeContext.theme)
    ? themeContext.theme
    : "dark";
  const SelectedIcon =
    themeOptions.find(({ value }) => value === selectedTheme)?.icon ?? MoonIcon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label="Wybierz motyw"
          title="Wybierz motyw"
        >
          <SelectedIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-44"
        data-management-theme="true"
      >
        <DropdownMenuLabel>Motyw panelu</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={selectedTheme}
          onValueChange={(value) => {
            if (isAdminTheme(value)) {
              themeContext.setTheme(value);
            }
          }}
        >
          {themeOptions.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function subscribeToMountState() {
  return () => undefined;
}

function getClientMountState() {
  return true;
}

function getServerMountState() {
  return false;
}

function isAdminTheme(value: string | undefined): value is AdminTheme {
  return themeOptions.some((option) => option.value === value);
}
