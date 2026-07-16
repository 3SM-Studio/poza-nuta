import type { ReactNode } from "react";

import type { PlatformAdminPageAccess } from "@/server/platform-admin/page-access-core";

import { AdminAccessDenied } from "./admin-access-denied";
import { AdminShell } from "./admin-shell";

export function AdminLayoutView({
  access,
  children,
}: {
  access: Exclude<PlatformAdminPageAccess, { kind: "unauthenticated" }>;
  children: ReactNode;
}) {
  if (access.kind === "denied") {
    return <AdminAccessDenied />;
  }

  return <AdminShell actor={access.actor}>{children}</AdminShell>;
}
