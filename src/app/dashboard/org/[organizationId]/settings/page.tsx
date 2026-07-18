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

import { ArchiveOrganizationForm } from "../../../../../components/operator/archive-organization-form";
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
    <main className={"min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground"}>
      <section className={"mx-auto w-full min-w-0 max-w-[72rem]"}>
        <header className={"mb-4 flex min-w-0 flex-col gap-4 py-1 sm:flex-row sm:items-center sm:justify-between [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight lg:[&_h1]:text-3xl"}>
          <div>
            <h1>Ustawienia</h1>
            <p className={"mt-1.5 text-sm text-muted-foreground"}>{access.organization.name}</p>
          </div>
          <Badge variant={access.organization.active ? "secondary" : "destructive"}>
            {access.organization.active ? "Aktywna" : "Nieaktywna"}
          </Badge>
        </header>

        <div className={"grid min-w-0 gap-4"}>
          <Card>
            <CardHeader>
              <CardTitle>Dane organizacji</CardTitle>
              <CardDescription>
                Public ID jest technicznym identyfikatorem URL i nie jest
                edytowalny.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className={"grid grid-cols-1 gap-3 sm:grid-cols-2 [&_div]:rounded-md [&_div]:bg-muted/40 [&_div]:p-3 [&_dt]:text-xs [&_dt]:font-semibold [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:text-sm [&_dd]:font-semibold"}>
                <div>
                  <dt>Nazwa</dt>
                  <dd>{access.organization.name}</dd>
                </div>
                <div>
                  <dt>ID organizacji</dt>
                  <dd className={"min-w-0 break-all [overflow-wrap:anywhere]"}>
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
                Tylko właściciel może zmienić nazwę organizacji.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className={"grid gap-4 [&_button]:justify-self-start"} action={updateName}>
                <input type="hidden" name="organizationId" value={organizationId} />
                <div className={"grid gap-2 [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
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
                  className={`${"inline-flex min-h-11 items-center justify-center rounded-md border border-transparent px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"} ${"border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"}`}
                  type="submit"
                  disabled={!canManageOrganization}
                >
                  Zapisz nazwę
                </button>
              </form>
            </CardContent>
          </Card>

          <ArchiveOrganizationForm
            action={archiveOrganization}
            canArchive={canManageOrganization}
            organizationId={access.organization.publicId}
            organizationName={access.organization.name}
          />
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
  const confirmationOrganizationId = String(
    formData.get("confirmationOrganizationId") ?? "",
  );

  if (confirmationOrganizationId !== organizationId) {
    throw new Error("Organization archive confirmation did not match.");
  }

  await archiveDashboardOrganizationForAuthUser({
    authUserId: session.authUser.id,
    organizationId,
  });

  redirect("/dashboard/organizations");
}

function formatRole(role: string) {
  switch (role) {
    case "owner":
      return "Właściciel";
    case "manager":
      return "Menedżer";
    case "operator":
      return "Operator";
    case "viewer":
      return "Podgląd";
    default:
      return role;
  }
}
