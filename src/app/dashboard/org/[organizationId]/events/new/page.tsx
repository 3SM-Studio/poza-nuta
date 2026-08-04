import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CreateEventForm,
  type CreateEventFormState,
} from "@/components/operator/create-event-form";
import {
  getDashboardOrganizationEventPath,
  getDashboardOrganizationEventsPath,
} from "@/lib/dashboard-routes";
import { OperatorApiError } from "@/server/operator-api/errors";
import {
  canCreateDashboardOrganizationEvent,
  createDashboardOrganizationEventForAuthUser,
  getDashboardOrganizationForAuthUser,
} from "@/server/operator-api/organizations";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";
import { validateCreateDashboardEventInput } from "@/server/operator-api/validation";

export const metadata: Metadata = {
  title: "Nowe wydarzenie | Poza Nutą",
};

export const dynamic = "force-dynamic";

type NewOrganizationEventPageProps = {
  params: Promise<{
    organizationId: string;
  }>;
};

export default async function NewOrganizationEventPage({
  params,
}: NewOrganizationEventPageProps) {
  const { organizationId } = await params;
  const session = await requireOperatorSession();
  const organization = await getDashboardOrganizationForAuthUser(
    session.authUser.id,
    organizationId,
  );

  if (!organization) {
    notFound();
  }

  const eventsPath = getDashboardOrganizationEventsPath(organization.publicId);

  return (
    <main className={"min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground"}>
      <section className={"mx-auto w-full min-w-0 max-w-[58rem]"}>
        <header className={"mb-4 flex min-w-0 flex-col gap-4 py-1 sm:flex-row sm:items-center sm:justify-between [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight lg:[&_h1]:text-3xl"}>
          <div>
            <h1>Utwórz wydarzenie</h1>
            <p className={"mt-1.5 text-sm text-muted-foreground"}>{organization.name}</p>
          </div>
        </header>

        {canCreateDashboardOrganizationEvent(organization.role) ? (
          <Card>
            <CardHeader>
              <CardTitle>Dane wydarzenia</CardTitle>
              <CardDescription>
                Kod sesji zostanie utworzony automatycznie razem z wydarzeniem.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CreateEventForm
                action={createEvent.bind(null, organization.publicId)}
                cancelPath={eventsPath}
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Brak uprawnień</CardTitle>
              <CardDescription>
                Wydarzenia mogą tworzyć tylko właściciele i menedżerowie
                organizacji.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </section>
    </main>
  );
}

async function createEvent(
  organizationId: string,
  _state: CreateEventFormState,
  formData: FormData,
): Promise<CreateEventFormState> {
  "use server";

  const validation = validateCreateDashboardEventInput({
    title: formData.get("title"),
    venue: formData.get("venue"),
    startsAt: formData.get("startsAt"),
    autoCloseAt: formData.get("autoCloseAt"),
    facebookUrl: formData.get("facebookUrl"),
    songRequestsEnabled: formData.has("songRequestsEnabled"),
    publicQueueEnabled: formData.has("publicQueueEnabled"),
    publicShowSongTitles: formData.has("publicShowSongTitles"),
    isActivePublicEvent: formData.has("isActivePublicEvent"),
  });

  if (!validation.success) {
    return {
      issues: validation.issues,
      message: "Popraw dane wydarzenia.",
    };
  }

  const session = await requireOperatorSession();

  try {
    const result = await createDashboardOrganizationEventForAuthUser({
      authUserId: session.authUser.id,
      organizationId,
      event: validation.data,
    });
    const eventsPath = getDashboardOrganizationEventsPath(
      result.organization.publicId,
    );

    revalidatePath(eventsPath);
    redirect(
      getDashboardOrganizationEventPath(
        result.organization.publicId,
        result.event.publicId,
      ),
    );
  } catch (error) {
    if (error instanceof OperatorApiError && error.status === 403) {
      return {
        issues: [],
        message: "Nie masz uprawnień do tworzenia wydarzeń w tej organizacji.",
      };
    }

    throw error;
  }
}
