"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";

import { ThemeSwitcher } from "@/components/theme-switcher";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function SiteHeader({
  section,
  title,
  context,
  actions,
  breadcrumbs,
}: {
  section: string;
  title: string;
  context?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: SiteHeaderBreadcrumb[];
}) {
  return (
    <header
      data-site-header="true"
      className="sticky top-0 z-30 flex min-h-14 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur sm:px-5"
    >
      <SidebarTrigger className="size-9" />
      <div className="min-w-0 flex-1" data-site-header-title={title}>
        <Breadcrumb>
          {breadcrumbs?.length ? (
            <BreadcrumbList className="flex-nowrap overflow-hidden">
              {breadcrumbs.map((item, index) => {
                const current = index === breadcrumbs.length - 1;
                const compact = index < breadcrumbs.length - 2;
                const startsCompactTrail = index === breadcrumbs.length - 2;

                return (
                  <Fragment key={`${item.label}-${index}`}>
                    {index > 0 ? (
                      <BreadcrumbSeparator
                        className={
                          compact || startsCompactTrail
                            ? "hidden lg:list-item"
                            : "list-item"
                        }
                      />
                    ) : null}
                    <BreadcrumbItem
                      className={
                        compact ? "hidden min-w-0 lg:inline-flex" : "min-w-0"
                      }
                    >
                      {current || !item.href ? (
                        <BreadcrumbPage className="truncate">
                          {item.label}
                        </BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink asChild className="truncate">
                          <Link href={item.href}>{item.label}</Link>
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                );
              })}
            </BreadcrumbList>
          ) : (
            <BreadcrumbList className="flex-nowrap">
              <BreadcrumbItem className="hidden min-w-0 sm:inline-flex">
                {context ?? <span className="truncate">{section}</span>}
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden sm:list-item" />
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className="truncate">{title}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          )}
        </Breadcrumb>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        <ThemeSwitcher managementTheme />
      </div>
    </header>
  );
}

export type SiteHeaderBreadcrumb = {
  label: string;
  href?: string;
};
