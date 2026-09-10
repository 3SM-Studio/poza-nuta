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
    <main className={"min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground"}>
      <section className={"mx-auto grid min-h-[calc(100vh-7.5rem)] w-full max-w-[42rem] place-items-center"}>
        <Card className={"w-full"}>
          <CardHeader>
            <CardTitle>Utwórz nową organizację</CardTitle>
            <CardDescription>
              Organizacje grupują Twoje wydarzenia karaoke, zespół i
              ustawienia.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className={"grid gap-4 [&_button]:justify-self-start"} action={createOrganization}>
              <div className={"grid gap-2 [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
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

              <section className={"grid min-w-0 gap-3 rounded-md border border-border bg-muted/30 p-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:leading-snug"} aria-labelledby="type-title">
                <div>
                  <h2 id="type-title">Typ</h2>
                  <p className={"mt-1.5 text-sm text-muted-foreground"}>
                    To pole jest teraz tylko informacyjne i nie jest zapisywane
                    w bazie.
                  </p>
                </div>
                <div className={"w-fit rounded-full border border-border bg-muted px-3 py-1.5 text-sm font-semibold text-foreground"}>Osobista</div>
              </section>

              <section className={"grid min-w-0 gap-3 rounded-md border border-border bg-muted/30 p-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:leading-snug"} aria-labelledby="plan-title">
                <div>
                  <h2 id="plan-title">Plan</h2>
                  <p className={"mt-1.5 text-sm text-muted-foreground"}>
                    Rozliczenia nie są wdrażane w tym etapie.
                  </p>
                </div>
                <div className={"w-fit rounded-full border border-border bg-muted px-3 py-1.5 text-sm font-semibold text-foreground"}>Darmowy</div>
              </section>

              <div className={"flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&>*]:max-w-full"}>
                <Button variant="outline" asChild>
                  <Link href={cancelPath}>Anuluj</Link>
                </Button>
                <button
                  className={`${"inline-flex min-h-11 items-center justify-center rounded-md border border-transparent px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"} ${"border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"}`}
                  type="submit"
                >
                  Utwórz organizację
                </button>
              </div>
            </form>
          </CardContent>
          <CardFooter>
            <p className={"mt-1.5 text-sm text-muted-foreground"}>
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
