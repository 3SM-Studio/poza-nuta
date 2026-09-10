"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { getActiveNavigationHref } from "@/components/app-shell/navigation";
import type { AdminActorViewModel } from "@/server/platform-admin/page-access-core";

import { AdminSidebar, getAdminNavigationGroups } from "./admin-sidebar";

export function AdminShell({
  actor,
  children,
}: {
  actor: AdminActorViewModel;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const groups = getAdminNavigationGroups(actor.role);
  const activeHref = getActiveNavigationHref(pathname, groups);
  const title = groups
    .flatMap((group) => group.items)
    .find((item) => item.href === activeHref)?.label ?? "Administracja";

  return (
    <AppShell
      kind="admin"
      sidebar={<AdminSidebar actor={actor} pathname={pathname} />}
      section="Administracja"
      title={title}
    >
      {children}
    </AppShell>
  );
}
