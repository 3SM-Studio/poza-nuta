import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import { DashboardUserMenu } from "../../components/operator/dashboard-user-menu";
import styles from "../../components/operator/operator.module.css";
import { OperatorApiError } from "../../server/operator-api/errors";
import { requireOperatorSession } from "../../server/operator-api/supabase-session";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const session = await getDashboardSession();

  return (
    <div className={styles.dashboardShell}>
      <header className={styles.dashboardHeader}>
        <div className={styles.dashboardHeaderInner}>
          <Link className={styles.dashboardBrand} href="/dashboard">
            <span>Poza Nutą</span>
            <strong>Dashboard</strong>
          </Link>

          <nav
            className={styles.dashboardNavigation}
            aria-label="Główna nawigacja dashboardu"
          >
            <Button variant="ghost" asChild>
              <Link href="/dashboard">Dashboard</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/dashboard/queue">Kolejka</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/dashboard/settings">Ustawienia</Link>
            </Button>
          </nav>

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
