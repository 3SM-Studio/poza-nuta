"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { logoutOperator, OperatorClientError } from "./api";

type DashboardUserMenuProps = {
  operatorName: string;
  email: string | null;
};

export function DashboardUserMenu({
  operatorName,
  email,
}: DashboardUserMenuProps) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    setIsLoggingOut(true);
    setError(null);

    try {
      await logoutOperator();
      router.replace("/sign-in");
      router.refresh();
    } catch (caughtError) {
      if (
        caughtError instanceof OperatorClientError &&
        caughtError.status === 401
      ) {
        router.replace("/sign-in");
        router.refresh();
        return;
      }

      setError("Nie udało się wylogować.");
      setIsLoggingOut(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-auto max-w-64 justify-start py-1"
          aria-label={`Menu użytkownika: ${operatorName}`}
        >
          <Avatar>
            <AvatarFallback>{getInitial(operatorName)}</AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 text-left sm:grid">
            <strong className="truncate text-sm">{operatorName}</strong>
            {email ? (
              <small className="truncate text-xs font-normal text-muted-foreground">
                {email}
              </small>
            ) : null}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="grid min-w-0">
          <strong className="truncate text-sm text-foreground">
            {operatorName}
          </strong>
          {email ? (
            <span className="truncate font-normal">{email}</span>
          ) : null}
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {error ? (
          <>
            <p className="px-1.5 py-1 text-xs text-destructive" role="alert">
              {error}
            </p>
            <DropdownMenuSeparator />
          </>
        ) : null}

        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href="/dashboard/account/me">Moje konto</Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isLoggingOut}
            onSelect={() => void handleLogout()}
          >
            {isLoggingOut ? "Wylogowywanie…" : "Wyloguj"}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getInitial(name: string) {
  return name.trim().charAt(0).toLocaleUpperCase("pl-PL") || "O";
}
