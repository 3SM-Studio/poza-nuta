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
  isDashboardNavigationLinkActive,
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
          label: "Przegląd",
        },
        {
          href: getDashboardOrganizationEventsPath(organizationId),
          label: "Wydarzenia",
        },
        {
          href: getDashboardOrganizationTeamPath(organizationId),
          label: "Zespół",
        },
        {
          href: getDashboardOrganizationSettingsPath(organizationId),
          label: "Ustawienia",
        },
      ]
    : [
        {
          href: isNewOrganizationRoute
            ? getDashboardNewOrganizationPath()
            : getDashboardOrganizationsPath(),
          label: isNewOrganizationRoute ? "Nowa organizacja" : "Organizacje",
        },
      ];

  return (
    <nav
      className={styles.dashboardNavigation}
      aria-label="Glowna nawigacja dashboardu"
    >
      {links.map((link) => {
        const isActive = isDashboardNavigationLinkActive(pathname, link.href);

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
