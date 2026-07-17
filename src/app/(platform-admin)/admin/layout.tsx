import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SIDEBAR_COOKIE_NAME } from "@/components/app-shell/sidebar-state";
import { AdminLayoutView } from "@/components/platform-admin/admin-layout-view";
import { SidebarProvider } from "@/components/ui/sidebar";
import { requirePlatformAdminAccess } from "@/server/platform-admin/guard";
import { resolvePlatformAdminPageAccess } from "@/server/platform-admin/page-access-core";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Administracja | Poza Nutą",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function PlatformAdminLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const access = await resolvePlatformAdminPageAccess(() =>
    requirePlatformAdminAccess("admin.access"),
  );

  if (access.kind === "unauthenticated") {
    redirect("/sign-in");
  }

  const cookieStore = await cookies();
  const sidebarDefaultOpen =
    cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== "false";

  return (
    <SidebarProvider
      defaultOpen={sidebarDefaultOpen}
      data-management-theme="true"
      className="bg-sidebar text-foreground"
    >
      <AdminLayoutView access={access}>{children}</AdminLayoutView>
    </SidebarProvider>
  );
}
