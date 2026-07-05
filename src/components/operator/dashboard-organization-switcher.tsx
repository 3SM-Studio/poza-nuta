"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";

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
import {
  getDashboardNewOrganizationPath,
  getDashboardOrganizationsPath,
  getDashboardOrganizationPath,
} from "@/lib/dashboard-routes";

import styles from "./operator.module.css";

type DashboardOrganizationSwitcherItem = {
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
  const currentOrganizationId = getSelectedOrganizationId(pathname);
  const currentOrganization = organizations.find(
    (organization) => organization.organizationId === currentOrganizationId,
  );
  const triggerLabel = currentOrganization?.name ?? "Wybierz organizację";

  if (!currentOrganizationId) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={styles.organizationSwitcherTrigger}
          aria-label="Wybierz organizację"
        >
          <span className={styles.organizationSwitcherText}>{triggerLabel}</span>
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
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
                  >
                    <span className="grid min-w-0">
                      <strong className="truncate">{organization.name}</strong>
                      <span className="truncate text-xs text-muted-foreground">
                        /{organization.organizationId} ·{" "}
                        {formatRole(organization.role)}
                      </span>
                    </span>
                  </Link>
                </DropdownMenuItem>
              );
            })
          ) : (
            <DropdownMenuItem disabled>Brak przypisanych organizacji</DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={getDashboardOrganizationsPath()}>Wszystkie organizacje</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={getDashboardNewOrganizationPath()}>
            Utwórz nową organizację
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
      return "Owner";
    case "manager":
      return "Manager";
    case "operator":
      return "Operator";
    case "viewer":
      return "Viewer";
    default:
      return role;
  }
}
