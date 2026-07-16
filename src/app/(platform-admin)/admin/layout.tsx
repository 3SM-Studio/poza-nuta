import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AdminLayoutView } from "@/components/platform-admin/admin-layout-view";
import { AdminThemeProvider } from "@/components/platform-admin/admin-theme-provider";
import { requirePlatformAdminAccess } from "@/server/platform-admin/guard";
import { resolvePlatformAdminPageAccess } from "@/server/platform-admin/page-access-core";

import "./admin-theme.css";

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

  return (
    <AdminThemeProvider>
      <AdminLayoutView access={access}>{children}</AdminLayoutView>
    </AdminThemeProvider>
  );
}
