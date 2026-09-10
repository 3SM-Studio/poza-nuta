"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AudioLinesIcon } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";

import type { AppNavigationGroup } from "./navigation";
import { AppSidebarUser, type AppSidebarUserModel } from "./app-sidebar-user";
import { SidebarNavigation } from "./sidebar-navigation";

export function AppSidebar({
  ariaLabel,
  homeHref,
  contextLabel,
  groups,
  pathname,
  user,
  managementTheme = false,
  header,
  navigationHeading,
}: {
  ariaLabel: string;
  homeHref: string;
  contextLabel: string;
  groups: AppNavigationGroup[];
  pathname: string;
  user: AppSidebarUserModel;
  managementTheme?: boolean;
  header?: ReactNode;
  navigationHeading?: {
    label: string;
    title: string;
  };
}) {
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar
      variant="inset"
      collapsible="icon"
      aria-label={ariaLabel}
      mobileManagementTheme={managementTheme}
    >
      <SidebarHeader>
        {header ?? (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                asChild
                tooltip={{
                  children: "Poza Nutą",
                  "data-management-theme": managementTheme ? "true" : undefined,
                }}
              >
                <Link href={homeHref} onClick={() => setOpenMobile(false)}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
                    <AudioLinesIcon aria-hidden="true" />
                  </span>
                  <span className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate font-semibold">Poza Nutą</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {contextLabel}
                    </span>
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
        {navigationHeading ? (
          <div
            data-slot="sidebar-navigation-heading"
            className="min-w-0 px-2 pb-1 group-data-[collapsible=icon]:hidden"
          >
            <span className="block text-xs font-medium text-muted-foreground">
              {navigationHeading.label}
            </span>
            <strong
              className="mt-0.5 block truncate text-sm text-sidebar-foreground"
              title={navigationHeading.title}
            >
              {navigationHeading.title}
            </strong>
          </div>
        ) : null}
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent className="overflow-hidden">
        <ScrollArea
          data-sidebar-navigation-scroll
          className="min-h-0 flex-1"
          viewportProps={{
            "aria-label": `${ariaLabel} — przewijana sekcja`,
          }}
        >
          <SidebarNavigation
            groups={groups}
            pathname={pathname}
            ariaLabel={ariaLabel}
            managementTheme={managementTheme}
          />
        </ScrollArea>
      </SidebarContent>
      <SidebarSeparator />
      <SidebarFooter>
        <AppSidebarUser user={user} managementTheme={managementTheme} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
