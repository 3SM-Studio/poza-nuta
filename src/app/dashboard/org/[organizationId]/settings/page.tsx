import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { resolveDashboardOrganizationAccess } from "@/lib/dashboard-organization-access";

import styles from "../../../../../components/operator/operator.module.css";
import {
  archiveDashboardOrganizationForAuthUser,
  getDashboardOrganizationForAuthUser,
  updateDashboardOrganizationNameForAuthUser,
} from "../../../../../server/operator-api/organizations";
import { requireOperatorSession } from "../../../../../server/operator-api/supabase-session";

export const metadata: Metadata = {
  title: "Ustawienia organizacji | Poza Nutą",
};

export const dynamic = "force-dynamic";

type OrganizationSettingsPageProps = {
  params: Promise<{
    organizationId: string;
  }>;
};

export default async function OrganizationSettingsPage({
  params,
}: OrganizationSettingsPageProps) {
  const { organizationId } = await params;
  const session = await requireOperatorSession();
  const organization = await getDashboardOrganizationForAuthUser(
    session.authUser.id,
    organizationId,
  );
  const access = resolveDashboardOrganizationAccess(organization);

  if (!access.allowed) {
    notFound();
  }

  const canManageOrganization = access.organization.role === "owner";

  return (
    <main className={styles.queuePage}>
      <section className={styles.organizationShell}>
        <header className={styles.pageHeader}>
          <div>
            <h1>Ustawienia</h1>
            <p className={styles.eventMeta}>{access.organization.name}</p>
          </div>
          <Badge variant={access.organization.active ? "secondary" : "destructive"}>
            {access.organization.active ? "Aktywna" : "Nieaktywna"}
          </Badge>
        </header>

        <div className={styles.organizationList}>
          <Card>
            <CardHeader>
              <CardTitle>Dane organizacji</CardTitle>
              <CardDescription>
                Public ID jest technicznym identyfikatorem URL i nie jest
                edytowalny.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className={styles.eventDetails}>
                <div>
                  <dt>Nazwa</dt>
                  <dd>{access.organization.name}</dd>
                </div>
                <div>
                  <dt>Organization ID</dt>
                  <dd className={styles.breakValue}>
                    {access.organization.publicId}
                  </dd>
                </div>
                <div>
                  <dt>Handle techniczny</dt>
                  <dd>{access.organization.handle}</dd>
                </div>
                <div>
                  <dt>Rola</dt>
                  <dd>{formatRole(access.organization.role)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Zmień nazwę</CardTitle>
              <CardDescription>
                Tylko owner może zmienić nazwę organizacji.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className={styles.settingsForm} action={updateName}>
                <input type="hidden" name="organizationId" value={organizationId} />
                <div className={styles.dashboardField}>
                  <label htmlFor="organization-name">Nazwa organizacji</label>
                  <input
                    id="organization-name"
                    name="name"
                    type="text"
                    defaultValue={access.organization.name}
                    required
                    maxLength={160}
                    disabled={!canManageOrganization}
                  />
                </div>
                <button
                  className={`${styles.button} ${styles.primaryButton}`}
                  type="submit"
                  disabled={!canManageOrganization}
                >
                  Zapisz nazwę
                </button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Archiwizacja</CardTitle>
              <CardDescription>
                Archiwizacja ustawia active=false. Nie usuwa eventów, requestów
                ani membershipów.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className={styles.settingsForm} action={archiveOrganization}>
                <input type="hidden" name="organizationId" value={organizationId} />
                <button
                  className={`${styles.button} ${styles.secondaryButton}`}
                  type="submit"
                  disabled={!canManageOrganization}
                >
                  Archiwizuj organizację
                </button>
              </form>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}

async function updateName(formData: FormData) {
  "use server";

  const session = await requireOperatorSession();
  const organizationId = String(formData.get("organizationId") ?? "");
  await updateDashboardOrganizationNameForAuthUser({
    authUserId: session.authUser.id,
    organizationId,
    name: String(formData.get("name") ?? ""),
  });

  redirect(`/dashboard/org/${encodeURIComponent(organizationId)}/settings`);
}

async function archiveOrganization(formData: FormData) {
  "use server";

  const session = await requireOperatorSession();
  const organizationId = String(formData.get("organizationId") ?? "");
  await archiveDashboardOrganizationForAuthUser({
    authUserId: session.authUser.id,
    organizationId,
  });

  redirect("/dashboard/organizations");
}

function formatRole(role: string) {
  switch (role) {
    case "owner":
      return "Owner";
    case "manager":
      return "Manager";
    case "operator":
      return "Operator";
    case "viewer":
      return "Viewer";
    default:
      return role;
  }
}
