"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  getDashboardOrganizationEventsPath,
  getDashboardOrganizationGeneralSettingsPath,
  getDashboardOrganizationPath,
} from "@/lib/dashboard-routes";

import styles from "./operator.module.css";

const dashboardLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/organizations", label: "Organizacje" },
  { href: "/dashboard/account/me", label: "Konto" },
] as const;

export function DashboardNavigation() {
  const pathname = usePathname();
  const orgHandle = getSelectedOrganizationHandle(pathname);
  const organizationLinks = orgHandle
    ? [
        { href: getDashboardOrganizationPath(orgHandle), label: "Organizacja" },
        {
          href: getDashboardOrganizationEventsPath(orgHandle),
          label: "Eventy",
        },
        {
          href: getDashboardOrganizationGeneralSettingsPath(orgHandle),
          label: "Ustawienia",
        },
      ]
    : [];

  return (
    <nav
      className={styles.dashboardNavigation}
      aria-label="Glowna nawigacja dashboardu"
    >
      {[...dashboardLinks, ...organizationLinks].map((link) => {
        const isActive =
          link.href === "/dashboard"
            ? pathname === link.href
            : pathname === link.href || pathname.startsWith(`${link.href}/`);

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

function getSelectedOrganizationHandle(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] !== "dashboard" || segments[1] !== "org") {
    return null;
  }

  return segments[2] ? decodeURIComponent(segments[2]) : null;
}
