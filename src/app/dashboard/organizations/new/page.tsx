import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDashboardOrganizationPath } from "@/lib/dashboard-routes";

import styles from "../../../../components/operator/operator.module.css";
import { createDashboardOrganizationForOperator } from "../../../../server/operator-api/organizations";
import { requireOperatorSession } from "../../../../server/operator-api/supabase-session";

export const metadata: Metadata = {
  title: "Nowa organizacja | Poza Nutą",
};

export const dynamic = "force-dynamic";

export default function NewDashboardOrganizationPage() {
  return (
    <main className={styles.queuePage}>
      <section className={styles.organizationShell}>
        <header className={styles.pageHeader}>
          <div>
            <h1>Nowa organizacja</h1>
            <p className={styles.eventMeta}>
              Utwórz workspace i przypisz siebie jako ownera.
            </p>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Dane organizacji</CardTitle>
            <CardDescription>
              Publiczne ID zostanie wygenerowane automatycznie.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className={styles.settingsForm} action={createOrganization}>
              <div className={styles.dashboardField}>
                <label htmlFor="organization-name">Nazwa organizacji</label>
                <input
                  id="organization-name"
                  name="name"
                  type="text"
                  required
                  maxLength={160}
                  autoComplete="organization"
                />
              </div>
              <button
                className={`${styles.button} ${styles.primaryButton}`}
                type="submit"
              >
                Utwórz organizację
              </button>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

async function createOrganization(formData: FormData) {
  "use server";

  const session = await requireOperatorSession();
  const organization = await createDashboardOrganizationForOperator({
    name: String(formData.get("name") ?? ""),
    operatorId: session.operator.id,
  });

  redirect(getDashboardOrganizationPath(organization.publicId));
}
