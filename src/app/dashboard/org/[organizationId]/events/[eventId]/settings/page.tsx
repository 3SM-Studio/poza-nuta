import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { EventManagementPanel } from "@/components/operator/event-management-panel";
import type { EventManagementActionState } from "@/components/operator/event-management-panel";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  areDashboardEventRequestsOpen,
  canManageDashboardEventLifecycle,
  getDashboardEventLifecycleStatus,
  shouldShowDashboardEventClosingWarning,
} from "@/lib/dashboard-event-lifecycle";
import {
  canReopenEvent,
  canResolveEventJoinCode,
  getEventReopenDeadline,
} from "@/lib/event-session-lifecycle";
import {
  getDashboardOrganizationEventPath,
  getDashboardOrganizationEventQueuePath,
  getDashboardOrganizationEventSettingsPath,
  getDashboardOrganizationEventSharePath,
  getDashboardOrganizationEventsPath,
} from "@/lib/dashboard-routes";
import {
  formatWarsawDateTime,
  formatWarsawDateTimeLocal,
} from "@/lib/warsaw-time";
import { OperatorApiError } from "@/server/operator-api/errors";
import {
  canManageDashboardOrganizationEvent,
  closeDashboardOrganizationEventForAuthUser,
  extendDashboardOrganizationEventForAuthUser,
  getDashboardOrganizationEventSessionAccessForAuthUser,
  reopenDashboardOrganizationEventForAuthUser,
  rotateDashboardOrganizationEventSessionCodeForAuthUser,
  updateDashboardOrganizationEventDetailsForAuthUser,
} from "@/server/operator-api/organizations";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";
import {
  validateDashboardEventIdentifier,
  validateExtendDashboardEventInput,
  validateUpdateDashboardEventDetailsInput,
} from "@/server/operator-api/validation";

export const metadata: Metadata = {
  title: "Ustawienia wydarzenia | Poza Nutą",
};

export const dynamic = "force-dynamic";

type OrganizationEventDetailPageProps = {
  params: Promise<{
    organizationId: string;
    eventId: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type EventAction =
  | "details-updated"
  | "extended"
  | "closed"
  | "reopened"
  | "code-rotated";

const emptyActionState: EventManagementActionState = {
  issues: [],
  message: null,
};

export default async function OrganizationEventDetailPage({
  params,
  searchParams,
}: OrganizationEventDetailPageProps) {
  const { organizationId, eventId } = await params;
  const eventIdValidation = validateDashboardEventIdentifier(eventId);

  if (!eventIdValidation.success) {
    notFound();
  }

  const session = await requireOperatorSession();
  const result = await getDashboardOrganizationEventSessionAccessForAuthUser({
    authUserId: session.authUser.id,
    organizationId,
    eventId: eventIdValidation.data,
  });

  if (!result) {
    notFound();
  }

  if (eventId !== result.event.publicId) {
    redirect(
      getDashboardOrganizationEventSettingsPath(
        result.organization.publicId,
        result.event.publicId,
      ),
    );
  }

  const now = new Date();
  const lifecycleStatus = getDashboardEventLifecycleStatus(result.event, now);
  const requestsOpen = areDashboardEventRequestsOpen(result.event, now);
  const roleCanManage = canManageDashboardOrganizationEvent(
    result.organization.role,
  );
  const lifecycleCanManage = canManageDashboardEventLifecycle(
    result.event,
    now,
  );
  const canManage = roleCanManage && lifecycleCanManage;
  const canReopen = roleCanManage && canReopenEvent(result.event, now);
  const canRotateCode =
    roleCanManage && canResolveEventJoinCode(result.event, now);
  const reopenDeadline = getEventReopenDeadline(result.event);
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const actionMessage = getActionMessage(resolvedSearchParams.eventAction);

  return (
    <main className={"min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground"}>
      <section className={"mx-auto w-full min-w-0 max-w-[72rem]"}>
        <header className={"mb-4 flex min-w-0 flex-col gap-4 py-1 sm:flex-row sm:items-center sm:justify-between [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight lg:[&_h1]:text-3xl"}>
          <div>
            <h1>Ustawienia wydarzenia</h1>
            <p className={"mt-1.5 text-sm text-muted-foreground"}>{result.event.name}</p>
          </div>
          <div className={"flex min-w-0 flex-wrap items-center gap-2 sm:justify-end"}>
            <Badge variant={getLifecycleStatusBadgeVariant(lifecycleStatus)}>
              {formatLifecycleStatus(lifecycleStatus)}
            </Badge>
          </div>
        </header>

        <div className={"grid min-w-0 gap-4"}>
          <Card>
            <CardHeader>
              <CardTitle>Szczegóły wydarzenia</CardTitle>
              <CardDescription>
                Panel zarządzania godziną zamknięcia i ręcznym zakończeniem
                wydarzenia.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className={"grid grid-cols-1 gap-3 sm:grid-cols-2 [&_div]:rounded-md [&_div]:bg-muted/40 [&_div]:p-3 [&_dt]:text-xs [&_dt]:font-semibold [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:text-sm [&_dd]:font-semibold"}>
                <div>
                  <dt>Status</dt>
                  <dd>{formatLifecycleStatus(lifecycleStatus)}</dd>
                </div>
                <div>
                  <dt>Zgłoszenia</dt>
                  <dd>{requestsOpen ? "Otwarte" : "Zamknięte"}</dd>
                </div>
                <div>
                  <dt>Start (czas polski)</dt>
                  <dd>{formatDateTime(result.event.startsAt)}</dd>
                </div>
                <div>
                  <dt>Czas zamknięcia (czas polski)</dt>
                  <dd>{formatDateTime(result.event.autoCloseAt)}</dd>
                </div>
                <div>
                  <dt>Publiczny event</dt>
                  <dd>{result.event.isActivePublicEvent ? "Tak" : "Nie"}</dd>
                </div>
                <div>
                  <dt>Katalog wydarzeń</dt>
                  <dd>{result.event.visibility === "public" ? "Opublikowany" : "Prywatny"}</dd>
                </div>
                <div>
                  <dt>Publiczna kolejka</dt>
                  <dd>{result.event.publicQueueEnabled ? "Włączona" : "Wyłączona"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <EventManagementPanel
            canManage={canManage}
            manageBlockedReason={getManageBlockedReason({
              roleCanManage,
              lifecycleStatus,
            })}
            initialValues={{
              title: result.event.name,
              venue: result.event.venue ?? "",
              city: result.event.city ?? "",
              slug: result.event.slug ?? "",
              visibility: result.event.visibility,
              startsAtInputValue: formatDateTimeLocalInput(
                result.event.startsAt,
              ),
              autoCloseAtInputValue: formatDateTimeLocalInput(
                result.event.autoCloseAt,
              ),
              facebookUrl: result.event.facebookUrl ?? "",
              songRequestsEnabled: result.event.songRequestsEnabled,
              publicQueueEnabled: result.event.publicQueueEnabled,
              publicShowSongTitles: result.event.publicShowSongTitles,
              isActivePublicEvent: result.event.isActivePublicEvent,
            }}
            showClosingWarning={shouldShowDashboardEventClosingWarning(
              result.event,
              now,
            )}
            detailsAction={updateEventDetails.bind(
              null,
              result.organization.publicId,
              result.event.publicId,
            )}
            extendAction={extendEvent.bind(
              null,
              result.organization.publicId,
              result.event.publicId,
            )}
            closeAction={closeEvent.bind(
              null,
              result.organization.publicId,
              result.event.publicId,
            )}
            reopenAction={reopenEvent.bind(
              null,
              result.organization.publicId,
              result.event.publicId,
            )}
            rotateCodeAction={rotateSessionCode.bind(
              null,
              result.organization.publicId,
              result.event.publicId,
              result.event.sessionCode,
            )}
            canReopen={canReopen}
            reopenDeadline={
              reopenDeadline ? reopenDeadline.toISOString() : null
            }
            canRotateCode={canRotateCode}
            successMessage={actionMessage}
          />
        </div>
      </section>
    </main>
  );
}

async function updateEventDetails(
  organizationId: string,
  eventId: string,
  _state: EventManagementActionState,
  formData: FormData,
): Promise<EventManagementActionState> {
  "use server";

  const validation = validateUpdateDashboardEventDetailsInput({
    title: formData.get("title"),
    venue: formData.get("venue"),
    city: formData.get("city"),
    slug: formData.get("slug"),
    visibility: formData.has("visibility") ? "public" : "private",
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
      message: "Popraw szczegóły wydarzenia.",
    };
  }

  const session = await requireOperatorSession();

  try {
    const result = await updateDashboardOrganizationEventDetailsForAuthUser({
      authUserId: session.authUser.id,
      organizationId,
      eventId,
      event: validation.data,
    });
    const path = getDashboardOrganizationEventSettingsPath(
      result.organization.publicId,
      result.event.publicId,
    );

    revalidateManagedEventPaths(result);
    redirect(`${path}?eventAction=details-updated`);
  } catch (error) {
    return mapEventManagementActionError(error);
  }
}

async function extendEvent(
  organizationId: string,
  eventId: string,
  _state: EventManagementActionState,
  formData: FormData,
): Promise<EventManagementActionState> {
  "use server";

  const validation = validateExtendDashboardEventInput({
    minutes: formData.get("minutes"),
    closesAt: formData.get("closesAt"),
  });

  if (!validation.success) {
    return {
      issues: validation.issues,
      message: "Wybierz poprawny czas wydłużenia.",
    };
  }

  const session = await requireOperatorSession();

  try {
    const result = await extendDashboardOrganizationEventForAuthUser({
      authUserId: session.authUser.id,
      organizationId,
      eventId,
      extension: validation.data,
    });
    const path = getDashboardOrganizationEventSettingsPath(
      result.organization.publicId,
      result.event.publicId,
    );

    revalidateManagedEventPaths(result);
    redirect(`${path}?eventAction=extended`);
  } catch (error) {
    return mapEventManagementActionError(error);
  }
}

async function reopenEvent(
  organizationId: string,
  eventId: string,
  _state: EventManagementActionState,
  formData: FormData,
): Promise<EventManagementActionState> {
  "use server";

  const validation = validateExtendDashboardEventInput({
    minutes: formData.get("minutes"),
    closesAt: formData.get("closesAt"),
  });
  if (!validation.success) {
    return { issues: validation.issues, message: "Wybierz nowy czas zamknięcia." };
  }

  const session = await requireOperatorSession();
  try {
    const result = await reopenDashboardOrganizationEventForAuthUser({
      authUserId: session.authUser.id,
      organizationId,
      eventId,
      extension: validation.data,
    });
    const path = getDashboardOrganizationEventSettingsPath(
      result.organization.publicId,
      result.event.publicId,
    );
    revalidateManagedEventPaths(result);
    redirect(`${path}?eventAction=reopened`);
  } catch (error) {
    return mapEventManagementActionError(error);
  }
}

async function rotateSessionCode(
  organizationId: string,
  eventId: string,
  expectedSessionCode: string,
  _state: EventManagementActionState,
  _formData: FormData,
): Promise<EventManagementActionState> {
  "use server";

  void _state;
  void _formData;

  const session = await requireOperatorSession();
  try {
    const result = await rotateDashboardOrganizationEventSessionCodeForAuthUser({
      authUserId: session.authUser.id,
      organizationId,
      eventId,
      expectedSessionCode,
    });
    const path = getDashboardOrganizationEventSettingsPath(
      result.organization.publicId,
      result.event.publicId,
    );
    revalidateManagedEventPaths(result);
    redirect(`${path}?eventAction=code-rotated`);
  } catch (error) {
    return mapEventManagementActionError(error);
  }
}

async function closeEvent(
  organizationId: string,
  eventId: string,
): Promise<EventManagementActionState> {
  "use server";

  const session = await requireOperatorSession();

  try {
    const result = await closeDashboardOrganizationEventForAuthUser({
      authUserId: session.authUser.id,
      organizationId,
      eventId,
    });
    const path = getDashboardOrganizationEventSettingsPath(
      result.organization.publicId,
      result.event.publicId,
    );

    revalidateManagedEventPaths(result);
    redirect(`${path}?eventAction=closed`);
  } catch (error) {
    return mapEventManagementActionError(error);
  }
}

function revalidateManagedEventPaths(input: {
  organization: { publicId: string };
  event: {
    id: number;
    publicId: string;
    sessionCode: string;
    slug: string | null;
  };
}) {
  const { event, organization } = input;

  revalidatePath(getDashboardOrganizationEventsPath(organization.publicId));
  revalidatePath(
    getDashboardOrganizationEventPath(organization.publicId, event.publicId),
  );
  revalidatePath(
    getDashboardOrganizationEventQueuePath(organization.publicId, event.publicId),
  );
  revalidatePath(
    getDashboardOrganizationEventSharePath(organization.publicId, event.publicId),
  );
  revalidatePath(
    getDashboardOrganizationEventSettingsPath(organization.publicId, event.publicId),
  );
  revalidatePath(`/join/${event.sessionCode}`);
  revalidatePath("/s/[token]", "page");

  if (event.slug) {
    revalidatePath(`/events/${event.slug}`);
  }
}

function mapEventManagementActionError(
  error: unknown,
): EventManagementActionState {
  if (error instanceof OperatorApiError) {
    if (error.status === 403) {
      return {
        ...emptyActionState,
        message: "Nie masz uprawnień do zarządzania tym wydarzeniem.",
      };
    }

    if (error.status === 404) {
      return {
        ...emptyActionState,
        message: "Nie znaleziono wydarzenia albo organizacji.",
      };
    }

    if (error.status === 409) {
      if (error.code === "ACTIVE_PUBLIC_EVENT_ALREADY_EXISTS") {
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

      if (error.code === "EVENT_SLUG_ALREADY_EXISTS") {
        return {
          issues: [
            {
              field: "slug",
              message: "Ten slug jest już zajęty przez inne wydarzenie.",
            },
          ],
          message: "Nie można opublikować wydarzenia z tym slugiem.",
        };
      }

      return {
        ...emptyActionState,
        message: "Stan wydarzenia zmienił się. Odśwież stronę i spróbuj ponownie.",
      };
    }

    if (error.status === 400) {
      if (
        error.code === "EVENT_PUBLICATION_SLUG_REQUIRED" ||
        error.code === "EVENT_SLUG_INVALID"
      ) {
        return {
          issues: [
            {
              field: "slug",
              message:
                "Podaj poprawny slug albo zostaw pole puste, aby wygenerować go z nazwy.",
            },
          ],
          message: "Nie można opublikować wydarzenia bez poprawnego sluga.",
        };
      }

      return {
        ...emptyActionState,
        message: "Sprawdź dane formularza.",
      };
    }
  }

  throw error;
}

function getLifecycleStatusBadgeVariant(status: string) {
  return status === "active"
    ? "default"
    : status === "closed" || status === "cancelled"
      ? "secondary"
      : "outline";
}

function formatLifecycleStatus(status: string) {
  switch (status) {
    case "active":
      return "Aktywne";
    case "cancelled":
      return "Anulowane";
    case "closed":
      return "Zamknięte";
    case "scheduled":
      return "Zaplanowane";
    default:
      return status;
  }
}

function getManageBlockedReason({
  roleCanManage,
  lifecycleStatus,
}: {
  roleCanManage: boolean;
  lifecycleStatus: string;
}) {
  if (!roleCanManage) {
    return "Twoja rola pozwala na podgląd wydarzenia, ale nie na zmianę czasu zamknięcia ani ręczne zamykanie.";
  }

  if (lifecycleStatus === "cancelled") {
    return "Wydarzenie jest anulowane, więc w MVP nie pozwalamy zmieniać jego ustawień.";
  }

  if (lifecycleStatus === "closed") {
    return "Minęło okno bezpiecznego przywrócenia tego wydarzenia.";
  }

  return "Zarządzanie tym wydarzeniem jest obecnie niedostępne.";
}

function getActionMessage(value: string | string[] | undefined) {
  const action = Array.isArray(value) ? value[0] : value;

  switch (action as EventAction | undefined) {
    case "details-updated":
      return "Szczegóły wydarzenia zostały zapisane.";
    case "extended":
      return "Wydarzenie zostało wydłużone.";
    case "closed":
      return "Wydarzenie zostało zamknięte.";
    case "reopened":
      return "Wydarzenie zostało ponownie otwarte.";
    case "code-rotated":
      return "Kod dołączenia został zmieniony.";
    default:
      return null;
  }
}

function formatDateTime(date: Date | null) {
  if (!date) {
    return "Brak terminu";
  }

  return formatWarsawDateTime(date);
}

function formatDateTimeLocalInput(date: Date | null) {
  return formatWarsawDateTimeLocal(date);
}
