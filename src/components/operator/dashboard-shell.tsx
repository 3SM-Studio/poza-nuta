"use client";

import { Fragment, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  getDashboardNewOrganizationPath,
  getDashboardOrganizationsPath,
  getDashboardOrganizationEventsPath,
  getDashboardOrganizationPath,
  getDashboardOrganizationSettingsPath,
  getDashboardOrganizationTeamPath,
  isDashboardNavigationLinkActive,
} from "@/lib/dashboard-routes";

import { DashboardOrganizationSwitcher } from "./dashboard-organization-switcher";
import { DashboardUserMenu } from "./dashboard-user-menu";
import styles from "./operator.module.css";

type DashboardShellOrganization = {
  id: number;
  name: string;
  organizationId: string;
  role: string;
};

type DashboardShellProps = {
  children: ReactNode;
  organizations: DashboardShellOrganization[];
  operatorName: string;
  email: string | null;
};

type BreadcrumbItemConfig = {
  label: string;
  href?: string;
  kind?: "organizationSwitcher";
};

export function DashboardShell({
  children,
  organizations,
  operatorName,
  email,
}: DashboardShellProps) {
  const pathname = usePathname();
  const organizationId = getSelectedOrganizationId(pathname);
  const currentOrganization = organizations.find(
    (organization) => organization.organizationId === organizationId,
  );
  const isAccountRoute = pathname.startsWith("/dashboard/account");
  const sidebar = organizationId ? (
    <OrganizationSidebar
      organizationId={organizationId}
      pathname={pathname}
    />
  ) : isAccountRoute ? (
    <AccountSidebar pathname={pathname} />
  ) : null;
  const layout = organizationId
    ? "organization"
    : isAccountRoute
      ? "account"
      : "simple";

  return (
    <div className={styles.dashboardShell} data-dashboard-layout={layout}>
      <header className={styles.dashboardTopbar} data-dashboard-topbar="true">
        <DashboardLogo />
        <DashboardHeaderBreadcrumbs
          items={getBreadcrumbItems({
            pathname,
            organizationId,
            organizationName: currentOrganization?.name,
          })}
          organizations={organizations}
        />
        <DashboardUserMenu operatorName={operatorName} email={email} />
      </header>

      <div
        className={
          sidebar
            ? styles.dashboardBody
            : `${styles.dashboardBody} ${styles.dashboardBodySimple}`
        }
        data-dashboard-body="true"
      >
        {sidebar}
        <div className={styles.dashboardMainColumn}>
          <div className={styles.dashboardContent}>{children}</div>
        </div>
      </div>
    </div>
  );
}

function DashboardHeaderBreadcrumbs({
  items,
  organizations,
}: {
  items: BreadcrumbItemConfig[];
  organizations: DashboardShellOrganization[];
}) {
  return (
    <div
      className={styles.dashboardTopbarBreadcrumbs}
      data-dashboard-header-breadcrumbs="true"
    >
      <Breadcrumb>
        <BreadcrumbList>
          {items.map((item, index) => {
            const isLast = index === items.length - 1;

            return (
              <Fragment key={`${item.label}-${index}`}>
                <BreadcrumbItem>
                  {item.kind === "organizationSwitcher" ? (
                    <DashboardOrganizationSwitcher organizations={organizations} />
                  ) : item.href && !isLast ? (
                    <BreadcrumbLink asChild>
                      <Link href={item.href}>{item.label}</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{item.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {!isLast ? <BreadcrumbSeparator /> : null}
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}

function OrganizationSidebar({
  organizationId,
  pathname,
}: {
  organizationId: string;
  pathname: string;
}) {
  const links = [
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
  ];

  return (
    <aside
      className={styles.dashboardSidebar}
      aria-label="Nawigacja organizacji"
      data-dashboard-org-sidebar="true"
    >
      <nav className={styles.dashboardSidebarNav} aria-label="Organizacja">
        {links.map((link) => {
          const isActive = isDashboardNavigationLinkActive(pathname, link.href);

          return (
            <Button
              key={link.href}
              variant="ghost"
              className={styles.dashboardSidebarLink}
              data-active={isActive}
              asChild
            >
              <Link
                href={link.href}
                aria-current={isActive ? "page" : undefined}
              >
                {link.label}
              </Link>
            </Button>
          );
        })}
      </nav>

      <Separator />

      <div className={styles.dashboardSidebarFooter}>
        <Link href={getDashboardOrganizationsPath()}>Wszystkie organizacje</Link>
        <Link href={getDashboardNewOrganizationPath()}>Utwórz organizację</Link>
      </div>
    </aside>
  );
}

function AccountSidebar({ pathname }: { pathname: string }) {
  const links = [
    {
      href: "/dashboard/account/me",
      label: "Profil",
    },
    {
      href: "/dashboard/account/security",
      label: "Bezpieczeństwo",
    },
  ];

  return (
    <aside
      className={styles.dashboardSidebar}
      aria-label="Nawigacja konta"
      data-dashboard-account-sidebar="true"
    >
      <div className={styles.dashboardSidebarSection}>
        <Button variant="outline" className={styles.dashboardSidebarLink} asChild>
          <Link href="/dashboard">Wróć do panelu</Link>
        </Button>
      </div>

      <nav className={styles.dashboardSidebarNav} aria-label="Konto">
        {links.map((link) => {
          const isActive = isDashboardNavigationLinkActive(pathname, link.href);

          return (
            <Button
              key={link.href}
              variant="ghost"
              className={styles.dashboardSidebarLink}
              data-active={isActive}
              asChild
            >
              <Link
                href={link.href}
                aria-current={isActive ? "page" : undefined}
              >
                {link.label}
              </Link>
            </Button>
          );
        })}
        <span className={styles.dashboardSidebarDisabled}>
          Dziennik audytu · Wkrótce
        </span>
      </nav>
    </aside>
  );
}

function DashboardLogo() {
  return (
    <Link
      className={styles.dashboardBrand}
      href="/dashboard"
      aria-label="Przejdź do dashboardu"
    >
      <Image
        className={styles.dashboardBrandLogo}
        src="/brand/poza_nuta_logo-white.png"
        alt="Poza Nutą"
        width={1254}
        height={1254}
      />
    </Link>
  );
}

function getBreadcrumbItems(input: {
  pathname: string;
  organizationId: string | null;
  organizationName?: string;
}): BreadcrumbItemConfig[] {
  if (input.organizationId) {
    return [
      {
        label: "Organizacje",
        href: getDashboardOrganizationsPath(),
      },
      {
        label: input.organizationName ?? input.organizationId,
        href: getDashboardOrganizationPath(input.organizationId),
        kind: "organizationSwitcher",
      },
      {
        label: getOrganizationSectionLabel(input.pathname, input.organizationId),
      },
    ];
  }

  if (input.pathname.startsWith("/dashboard/account")) {
    return [
      {
        label: "Konto",
        href: "/dashboard/account/me",
      },
      {
        label: input.pathname.startsWith("/dashboard/account/security")
          ? "Bezpieczeństwo"
          : "Profil",
      },
    ];
  }

  if (input.pathname === getDashboardNewOrganizationPath()) {
    return [
      {
        label: "Organizacje",
        href: getDashboardOrganizationsPath(),
      },
      {
        label: "Nowa organizacja",
      },
    ];
  }

  if (input.pathname === getDashboardOrganizationsPath()) {
    return [
      {
        label: "Organizacje",
      },
    ];
  }

  return [
    {
      label: "Panel",
    },
  ];
}

function getOrganizationSectionLabel(pathname: string, organizationId: string) {
  if (
    isDashboardNavigationLinkActive(
      pathname,
      getDashboardOrganizationEventsPath(organizationId),
    )
  ) {
    return "Wydarzenia";
  }

  if (
    isDashboardNavigationLinkActive(
      pathname,
      getDashboardOrganizationTeamPath(organizationId),
    )
  ) {
    return "Zespół";
  }

  if (
    isDashboardNavigationLinkActive(
      pathname,
      getDashboardOrganizationSettingsPath(organizationId),
    )
  ) {
    return "Ustawienia";
  }

  return "Przegląd";
}

function getSelectedOrganizationId(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] !== "dashboard" || segments[1] !== "org") {
    return null;
  }

  return segments[2] ? decodeURIComponent(segments[2]) : null;
}
