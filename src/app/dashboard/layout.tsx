import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Separator } from "@/components/ui/separator";

import { DashboardNavigation } from "../../components/operator/dashboard-navigation";
import { DashboardOrganizationSwitcher } from "../../components/operator/dashboard-organization-switcher";
import { DashboardUserMenu } from "../../components/operator/dashboard-user-menu";
import styles from "../../components/operator/operator.module.css";
import { OperatorApiError } from "../../server/operator-api/errors";
import { listDashboardOrganizationsForAuthUser } from "../../server/operator-api/organizations";
import { requireOperatorSession } from "../../server/operator-api/supabase-session";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const session = await getDashboardSession();
  const organizations = await listDashboardOrganizationsForAuthUser(
    session.authUser.id,
  ).then((items) =>
    items.map((organization) => ({
      id: organization.id,
      name: organization.name,
      organizationId: organization.publicId,
      role: organization.role,
    })),
  );

  return (
    <div className={styles.dashboardShell}>
      <header className={styles.dashboardHeader}>
        <div className={styles.dashboardHeaderInner}>
          <Link
            className={styles.dashboardBrand}
            href="/"
            aria-label="Przejdź na stronę główną"
          >
            <Image
              className={styles.dashboardBrandLogo}
              src="/brand/poza_nuta_logo-white.png"
              alt="Poza Nutą"
              width={1254}
              height={1254}
            />
            <strong>Dashboard</strong>
          </Link>

          <DashboardOrganizationSwitcher organizations={organizations} />

          <DashboardNavigation />

          <DashboardUserMenu
            operatorName={session.operator.name}
            email={session.authUser.email}
          />
        </div>
      </header>
      <Separator />

      <div className={styles.dashboardContent}>{children}</div>
    </div>
  );
}

async function getDashboardSession() {
  try {
    return await requireOperatorSession();
  } catch (error) {
    if (
      error instanceof OperatorApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      redirect("/sign-in");
    }

    throw error;
  }
}
