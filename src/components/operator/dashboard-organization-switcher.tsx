"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2Icon, ChevronsUpDownIcon } from "lucide-react";

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
import {
  getDashboardNewOrganizationPath,
  getDashboardOrganizationsPath,
  getDashboardOrganizationPath,
} from "@/lib/dashboard-routes";

export type DashboardOrganizationSwitcherItem = {
  id: number;
  name: string;
  organizationId: string;
  role: string;
};

type DashboardOrganizationSwitcherProps = {
  organizations: DashboardOrganizationSwitcherItem[];
};

export function DashboardOrganizationSwitcher({
  organizations,
}: DashboardOrganizationSwitcherProps) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const currentOrganizationId = getSelectedOrganizationId(pathname);
  const currentOrganization = organizations.find(
    (organization) => organization.organizationId === currentOrganizationId,
  );
  const triggerLabel = currentOrganization?.name ?? "Wybierz organizację";
  const triggerContext = currentOrganization
    ? `Poza Nutą · ${formatRole(currentOrganization.role)}`
    : "Poza Nutą";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              aria-label={`Wybierz organizację. Aktywna: ${triggerLabel}`}
              tooltip={{
                children: triggerLabel,
                "data-management-theme": "true",
              }}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
                {currentOrganization
                  ? getOrganizationInitials(currentOrganization.name)
                  : <Building2Icon aria-hidden="true" />}
              </span>
              <span className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-semibold">{triggerLabel}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {triggerContext}
                </span>
              </span>
              <ChevronsUpDownIcon className="ml-auto group-data-[collapsible=icon]:hidden" aria-hidden="true" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="start"
            className="w-72"
            data-management-theme="true"
          >
            <DropdownMenuLabel>Organizacje</DropdownMenuLabel>
            <DropdownMenuGroup>
              {organizations.length > 0 ? (
                organizations.map((organization) => {
                  const isActive =
                    organization.organizationId === currentOrganizationId;

                  return (
                    <DropdownMenuItem key={organization.id} asChild>
                      <Link
                        href={getDashboardOrganizationPath(
                          organization.organizationId,
                        )}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => setOpenMobile(false)}
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-foreground">
                          {getOrganizationInitials(organization.name)}
                        </span>
                        <span className="grid min-w-0">
                          <strong className="truncate">{organization.name}</strong>
                          <span className="truncate text-xs text-muted-foreground">
                            {formatRole(organization.role)}
                          </span>
                        </span>
                      </Link>
                    </DropdownMenuItem>
                  );
                })
              ) : (
                <DropdownMenuItem disabled>
                  Brak przypisanych organizacji
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link
                href={getDashboardOrganizationsPath()}
                onClick={() => setOpenMobile(false)}
              >
                Wszystkie organizacje
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href={getDashboardNewOrganizationPath()}
                onClick={() => setOpenMobile(false)}
              >
                Utwórz organizację
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function getOrganizationInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase("pl-PL") ?? "")
      .join("") || "PN"
  );
}

function getSelectedOrganizationId(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] !== "dashboard" || segments[1] !== "org") {
    return null;
  }

  return segments[2] ? decodeURIComponent(segments[2]) : null;
}

function formatRole(role: string) {
  switch (role) {
    case "owner":
      return "Właściciel";
    case "manager":
      return "Menedżer";
    case "operator":
      return "Operator";
    case "viewer":
      return "Podgląd";
    default:
      return role;
  }
}
