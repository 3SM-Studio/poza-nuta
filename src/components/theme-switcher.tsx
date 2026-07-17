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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const themeOptions = [
  { value: "dark", label: "Ciemny", icon: MoonIcon },
  { value: "light", label: "Jasny", icon: SunIcon },
  { value: "system", label: "Systemowy", icon: MonitorIcon },
] as const;

type AppTheme = (typeof themeOptions)[number]["value"];

export function ThemeSwitcher({
  managementTheme = false,
}: {
  managementTheme?: boolean;
}) {
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

  const selectedTheme = isAppTheme(themeContext.theme)
    ? themeContext.theme
    : "dark";
  const SelectedIcon =
    themeOptions.find(({ value }) => value === selectedTheme)?.icon ?? MoonIcon;

  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label="Wybierz motyw"
            >
              <SelectedIcon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          data-management-theme={managementTheme ? "true" : undefined}
        >
          Motyw
        </TooltipContent>
        <DropdownMenuContent
          align="end"
          className="w-44"
          data-management-theme={managementTheme ? "true" : undefined}
        >
          <DropdownMenuLabel>Motyw aplikacji</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={selectedTheme}
            onValueChange={(value) => {
              if (isAppTheme(value)) {
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
    </Tooltip>
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

function isAppTheme(value: string | undefined): value is AppTheme {
  return themeOptions.some((option) => option.value === value);
}
