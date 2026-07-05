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
} from "@/lib/dashboard-routes";

import styles from "../../../components/operator/operator.module.css";
import {
  createDashboardOrganizationForOperator,
  listDashboardOrganizationsForAuthUser,
} from "../../../server/operator-api/organizations";
import { requireOperatorSession } from "../../../server/operator-api/supabase-session";

export const metadata: Metadata = {
  title: "Nowa organizacja | Poza Nutą",
};

export const dynamic = "force-dynamic";

export default async function NewDashboardOrganizationPage() {
  const session = await requireOperatorSession();
  const organizations = await listDashboardOrganizationsForAuthUser(
    session.authUser.id,
  );
  const cancelPath =
    organizations.length > 0 ? getDashboardOrganizationsPath() : "/dashboard";

  return (
    <main className={styles.queuePage}>
      <section className={styles.onboardingShell}>
        <Card className={styles.onboardingCard}>
          <CardHeader>
            <CardTitle>Create a new organization</CardTitle>
            <CardDescription>
              Organizations group your karaoke events, team members and
              settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className={styles.settingsForm} action={createOrganization}>
              <div className={styles.dashboardField}>
                <label htmlFor="organization-name">Name</label>
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
                  <h2 id="type-title">Type</h2>
                  <p className={styles.eventMeta}>
                    This is informational for now and is not saved to the
                    database.
                  </p>
                </div>
                <div className={styles.readOnlyOption}>Personal</div>
              </section>

              <section className={styles.formSection} aria-labelledby="plan-title">
                <div>
                  <h2 id="plan-title">Plan</h2>
                  <p className={styles.eventMeta}>
                    Billing is not implemented in this stage.
                  </p>
                </div>
                <div className={styles.readOnlyOption}>Free</div>
              </section>

              <div className={styles.formActions}>
                <Button variant="outline" asChild>
                  <Link href={cancelPath}>Cancel</Link>
                </Button>
                <button
                  className={`${styles.button} ${styles.primaryButton}`}
                  type="submit"
                >
                  Create organization
                </button>
              </div>
            </form>
          </CardContent>
          <CardFooter>
            <p className={styles.eventMeta}>
              Organization ID is generated automatically after creation.
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
  const organization = await createDashboardOrganizationForOperator({
    name: String(formData.get("name") ?? ""),
    operatorId: session.operator.id,
  });

  revalidatePath("/dashboard", "layout");
  revalidatePath(getDashboardOrganizationsPath());

  redirect(getDashboardOrganizationPath(organization.publicId));
}
