"use client";

import type { ReactNode } from "react";

import { SidebarInset } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import { SiteHeader, type SiteHeaderBreadcrumb } from "./site-header";

export function AppShell({
  kind,
  layout,
  sidebar,
  section,
  title,
  headerContext,
  headerActions,
  headerBreadcrumbs,
  children,
  contentClassName,
}: {
  kind: "admin" | "dashboard";
  layout?: string;
  sidebar: ReactNode;
  section: string;
  title: string;
  headerContext?: ReactNode;
  headerActions?: ReactNode;
  headerBreadcrumbs?: SiteHeaderBreadcrumb[];
  children: ReactNode;
  contentClassName?: string;
}) {
  const mainId = kind === "admin" ? "admin-main" : "dashboard-main";
  const shellData =
    kind === "admin"
      ? { "data-admin-shell": "true" }
      : { "data-dashboard-shell": "true", "data-dashboard-layout": layout };

  return (
    <div className="contents" {...shellData}>
      <a
        href={`#${mainId}`}
        className="sr-only rounded-md bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Przejdź do treści
      </a>
      {sidebar}
      <SidebarInset id={mainId} tabIndex={-1}>
        <SiteHeader
          section={section}
          title={title}
          context={headerContext}
          actions={headerActions}
          {...(headerBreadcrumbs ? { breadcrumbs: headerBreadcrumbs } : {})}
        />
        <div
          className={cn(
            "mx-auto w-full max-w-[86rem] flex-1 p-4 sm:p-6 lg:p-8",
            contentClassName,
          )}
        >
          {children}
        </div>
      </SidebarInset>
    </div>
  );
}
