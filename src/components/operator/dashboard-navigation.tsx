"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";

import styles from "./operator.module.css";

const dashboardLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/queue", label: "Kolejka" },
  { href: "/dashboard/settings", label: "Ustawienia" },
] as const;

export function DashboardNavigation() {
  const pathname = usePathname();

  return (
    <nav
      className={styles.dashboardNavigation}
      aria-label="Glowna nawigacja dashboardu"
    >
      {dashboardLinks.map((link) => {
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
