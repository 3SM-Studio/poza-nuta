import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getDashboardOrganizationPath,
  getDashboardOrganizationsPath,
  getDashboardProfileOnboardingPath,
} from "@/lib/dashboard-routes";

import styles from "../../../components/operator/operator.module.css";
import {
  createDashboardOrganizationForOperator,
  listDashboardOrganizationsForAuthUser,
} from "../../../server/operator-api/organizations";
import {
  isOperatorProfileCompleted,
  requireOperatorSession,
} from "../../../server/operator-api/supabase-session";

export const metadata: Metadata = {
  title: "Nowa organizacja | Poza Nutą",
};

export const dynamic = "force-dynamic";

export default async function NewDashboardOrganizationPage() {
  const session = await requireOperatorSession();
  const organizations = await listDashboardOrganizationsForAuthUser(
    session.authUser.id,
  );

  if (
    !isOperatorProfileCompleted(session.operator) &&
    organizations.length === 0
  ) {
    redirect(getDashboardProfileOnboardingPath());
  }

  const cancelPath =
    organizations.length > 0 ? getDashboardOrganizationsPath() : "/dashboard";

  return (
    <main className={styles.queuePage}>
      <section className={styles.onboardingShell}>
        <Card className={styles.onboardingCard}>
          <CardHeader>
            <CardTitle>Utwórz nową organizację</CardTitle>
            <CardDescription>
              Organizacje grupują Twoje wydarzenia karaoke, zespół i
              ustawienia.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className={styles.settingsForm} action={createOrganization}>
              <div className={styles.dashboardField}>
                <label htmlFor="organization-name">Nazwa</label>
                <input
                  id="organization-name"
                  name="name"
                  type="text"
                  required
                  maxLength={160}
                  autoComplete="organization"
                />
              </div>

              <section className={styles.formSection} aria-labelledby="type-title">
                <div>
                  <h2 id="type-title">Typ</h2>
                  <p className={styles.eventMeta}>
                    To pole jest teraz tylko informacyjne i nie jest zapisywane
                    w bazie.
                  </p>
                </div>
                <div className={styles.readOnlyOption}>Osobista</div>
              </section>

              <section className={styles.formSection} aria-labelledby="plan-title">
                <div>
                  <h2 id="plan-title">Plan</h2>
                  <p className={styles.eventMeta}>
                    Rozliczenia nie są wdrażane w tym etapie.
                  </p>
                </div>
                <div className={styles.readOnlyOption}>Darmowy</div>
              </section>

              <div className={styles.formActions}>
                <Button variant="outline" asChild>
                  <Link href={cancelPath}>Anuluj</Link>
                </Button>
                <button
                  className={`${styles.button} ${styles.primaryButton}`}
                  type="submit"
                >
                  Utwórz organizację
                </button>
              </div>
            </form>
          </CardContent>
          <CardFooter>
            <p className={styles.eventMeta}>
              ID organizacji jest generowane automatycznie po utworzeniu.
            </p>
          </CardFooter>
        </Card>
      </section>
    </main>
  );
}

async function createOrganization(formData: FormData) {
  "use server";

  const session = await requireOperatorSession();
  const organizations = await listDashboardOrganizationsForAuthUser(
    session.authUser.id,
  );

  if (
    !isOperatorProfileCompleted(session.operator) &&
    organizations.length === 0
  ) {
    redirect(getDashboardProfileOnboardingPath());
  }

  const organization = await createDashboardOrganizationForOperator({
    name: String(formData.get("name") ?? ""),
    operatorId: session.operator.id,
  });

  revalidatePath("/dashboard", "layout");
  revalidatePath(getDashboardOrganizationsPath());

  redirect(getDashboardOrganizationPath(organization.publicId));
}
