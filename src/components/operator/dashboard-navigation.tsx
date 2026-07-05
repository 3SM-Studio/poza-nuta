"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  getDashboardNewOrganizationPath,
  getDashboardOrganizationsPath,
  getDashboardOrganizationEventsPath,
  getDashboardOrganizationPath,
  getDashboardOrganizationSettingsPath,
  getDashboardOrganizationTeamPath,
} from "@/lib/dashboard-routes";

import styles from "./operator.module.css";

export function DashboardNavigation() {
  const pathname = usePathname();
  const organizationId = getSelectedOrganizationId(pathname);
  const isNewOrganizationRoute = pathname === getDashboardNewOrganizationPath();
  const links = organizationId
    ? [
        {
          href: getDashboardOrganizationPath(organizationId),
          label: "Overview",
        },
        {
          href: getDashboardOrganizationEventsPath(organizationId),
          label: "Events",
        },
        {
          href: getDashboardOrganizationTeamPath(organizationId),
          label: "Team",
        },
        {
          href: getDashboardOrganizationSettingsPath(organizationId),
          label: "Settings",
        },
      ]
    : [
        {
          href: isNewOrganizationRoute
            ? getDashboardNewOrganizationPath()
            : getDashboardOrganizationsPath(),
          label: isNewOrganizationRoute ? "New organization" : "Organizations",
        },
      ];

  return (
    <nav
      className={styles.dashboardNavigation}
      aria-label="Glowna nawigacja dashboardu"
    >
      {links.map((link) => {
        const isActive =
          pathname === link.href || pathname.startsWith(`${link.href}/`);

        return (
          <Button
            key={link.href}
            variant="ghost"
            className={styles.dashboardNavigationLink}
            data-active={isActive}
            asChild
          >
            <Link href={link.href} aria-current={isActive ? "page" : undefined}>
              {link.label}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}

function getSelectedOrganizationId(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] !== "dashboard" || segments[1] !== "org") {
    return null;
  }

  return segments[2] ? decodeURIComponent(segments[2]) : null;
}
