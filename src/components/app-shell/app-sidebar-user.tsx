"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronUpIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  ShieldCheckIcon,
  UserRoundIcon,
} from "lucide-react";

import { logoutOperator, OperatorClientError } from "@/components/operator/api";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

export type AppSidebarUserModel = {
  displayName: string;
  initials: string;
  roleLabel: string;
  email?: string | null;
  canAccessAdmin: boolean;
};

export function AppSidebarUser({
  user,
  managementTheme = false,
}: {
  user: AppSidebarUserModel;
  managementTheme?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    setIsLoggingOut(true);
    setError(null);

    try {
      await logoutOperator();
      setOpenMobile(false);
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
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              aria-label={`Menu użytkownika: ${user.displayName}`}
              title={user.displayName}
            >
              <Avatar size="sm">
                <AvatarFallback>{user.initials}</AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-medium">{user.displayName}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {user.roleLabel}
                </span>
              </span>
              <ChevronUpIcon className="ml-auto group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="end"
            className="w-64"
            data-management-theme={managementTheme ? "true" : undefined}
          >
            <DropdownMenuLabel className="grid min-w-0">
              <strong className="truncate text-sm text-foreground">
                {user.displayName}
              </strong>
              <span className="truncate font-normal">{user.roleLabel}</span>
              {user.email ? (
                <span className="truncate font-normal">{user.email}</span>
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
              <AppMenuLink
                href="/dashboard"
                label="Panel organizatora"
                current={pathname.startsWith("/dashboard")}
                onNavigate={() => setOpenMobile(false)}
                icon={LayoutDashboardIcon}
              />
              {user.canAccessAdmin ? (
                <AppMenuLink
                  href="/admin"
                  label="Administracja"
                  current={pathname.startsWith("/admin")}
                  onNavigate={() => setOpenMobile(false)}
                  icon={ShieldCheckIcon}
                />
              ) : null}
              <AppMenuLink
                href="/account"
                label="Konto"
                current={pathname.startsWith("/account")}
                onNavigate={() => setOpenMobile(false)}
                icon={UserRoundIcon}
              />
              <DropdownMenuItem
                disabled={isLoggingOut}
                onSelect={() => void handleLogout()}
              >
                <LogOutIcon aria-hidden="true" />
                {isLoggingOut ? "Wylogowywanie…" : "Wyloguj"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function AppMenuLink({
  href,
  label,
  current,
  onNavigate,
  icon: Icon,
}: {
  href: string;
  label: string;
  current: boolean;
  onNavigate: () => void;
  icon: typeof LayoutDashboardIcon;
}) {
  return (
    <DropdownMenuItem asChild>
      <Link
        href={href}
        aria-current={current ? "page" : undefined}
        onClick={onNavigate}
      >
        <Icon aria-hidden="true" />
        {label}
      </Link>
    </DropdownMenuItem>
  );
}
