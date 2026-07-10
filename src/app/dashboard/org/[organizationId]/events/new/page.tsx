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
import styles from "@/components/operator/operator.module.css";
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
    <main className={styles.queuePage}>
      <section className={styles.settingsShell}>
        <header className={styles.pageHeader}>
          <div>
            <h1>Utwórz wydarzenie</h1>
            <p className={styles.eventMeta}>{organization.name}</p>
          </div>
        </header>

        {canCreateDashboardOrganizationEvent(organization.role) ? (
          <Card>
            <CardHeader>
              <CardTitle>Dane wydarzenia</CardTitle>
              <CardDescription>
                Czas zamknięcia zapisujemy jako auto_close_at. Link sesji
                zostanie dodany w kolejnym etapie.
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
        result.event.id,
      ),
    );
  } catch (error) {
    if (error instanceof OperatorApiError && error.status === 403) {
      return {
        issues: [],
        message: "Nie masz uprawnień do tworzenia wydarzeń w tej organizacji.",
      };
    }

    if (error instanceof OperatorApiError && error.status === 409) {
      return {
        issues: [
          {
            field: "isActivePublicEvent",
            message:
              "Ta organizacja ma już aktywny publicznie event. Wyłącz go przed ustawieniem kolejnego.",
          },
        ],
        message: "Nie można ustawić dwóch aktywnych publicznie eventów.",
      };
    }

    throw error;
  }
}
