"use client";

import type { ReactNode } from "react";

import { ThemeSwitcher } from "@/components/theme-switcher";
import {
  Breadcrumb,
  BreadcrumbItem,
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
}: {
  section: string;
  title: string;
  context?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header
      data-site-header="true"
      className="sticky top-0 z-30 flex min-h-14 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur sm:px-5"
    >
      <SidebarTrigger className="size-9" />
      <div className="min-w-0 flex-1" data-site-header-title={title}>
        <Breadcrumb>
          <BreadcrumbList className="flex-nowrap">
            <BreadcrumbItem className="hidden min-w-0 sm:inline-flex">
              {context ?? <span className="truncate">{section}</span>}
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden sm:list-item" />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="truncate">{title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        <ThemeSwitcher managementTheme />
      </div>
    </header>
  );
}
