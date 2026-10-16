"use client";

import Link from "next/link";
import { useUiText } from "@/i18n/use-ui-text";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

import {
  getActiveNavigationHref,
  type AppNavigationGroup,
} from "./navigation";

export function SidebarNavigation({
  groups,
  pathname,
  ariaLabel,
  managementTheme = false,
}: {
  groups: AppNavigationGroup[];
  pathname: string;
  ariaLabel: string;
  managementTheme?: boolean;
}) {
  const tx = useUiText();
  const { setOpenMobile } = useSidebar();
  const activeHref = getActiveNavigationHref(pathname, groups);

  return (
    <nav aria-label={tx(ariaLabel)}>
      {groups.map((group) => (
        <SidebarGroup
          key={group.label}
          {...(group.ariaLabel ? { "aria-label": tx(group.ariaLabel) } : {})}
        >
          {group.hideLabel ? null : (
            <SidebarGroupLabel>{tx(group.label)}</SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                const isActive = item.href === activeHref;
                const Icon = item.icon;

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={{
                        children: tx(item.label),
                        "data-management-theme": managementTheme
                          ? "true"
                          : undefined,
                      }}
                    >
                      <Link
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => setOpenMobile(false)}
                      >
                        <Icon aria-hidden="true" />
                        <span>{tx(item.label)}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </nav>
  );
}
