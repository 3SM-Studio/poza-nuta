import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { EventManagementPanel } from "@/components/operator/event-management-panel";
import type { EventManagementActionState } from "@/components/operator/event-management-panel";
import styles from "@/components/operator/operator.module.css";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  getDashboardOrganizationEventPath,
  getDashboardOrganizationEventsPath,
} from "@/lib/dashboard-routes";
import { OperatorApiError } from "@/server/operator-api/errors";
import {
  canManageDashboardOrganizationEvent,
  closeDashboardOrganizationEventForAuthUser,
  extendDashboardOrganizationEventForAuthUser,
  getDashboardOrganizationEventForAuthUser,
  updateDashboardOrganizationEventAutoCloseAtForAuthUser,
} from "@/server/operator-api/organizations";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";
import {
  validateEventId,
  validateExtendDashboardEventInput,
  validateUpdateDashboardEventAutoCloseAtInput,
} from "@/server/operator-api/validation";

export const metadata: Metadata = {
  title: "Wydarzenie | Poza Nutą",
};

export const dynamic = "force-dynamic";

type OrganizationEventDetailPageProps = {
  params: Promise<{
    organizationId: string;
    eventId: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type EventAction = "close-time-updated" | "extended" | "closed";

const emptyActionState: EventManagementActionState = {
  issues: [],
  message: null,
};

export default async function OrganizationEventDetailPage({
  params,
  searchParams,
}: OrganizationEventDetailPageProps) {
  const { organizationId, eventId } = await params;
  const eventIdValidation = validateEventId(eventId);

  if (!eventIdValidation.success) {
    notFound();
  }

  const session = await requireOperatorSession();
  const result = await getDashboardOrganizationEventForAuthUser({
    authUserId: session.authUser.id,
    organizationId,
    eventId: eventIdValidation.data,
  });

  if (!result) {
    notFound();
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
  const eventsPath = getDashboardOrganizationEventsPath(
    result.organization.publicId,
  );
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const actionMessage = getActionMessage(resolvedSearchParams.eventAction);

  return (
    <main className={styles.queuePage}>
      <section className={styles.organizationShell}>
        <header className={styles.pageHeader}>
          <div>
            <h1>{result.event.name}</h1>
            <p className={styles.eventMeta}>{result.organization.name}</p>
          </div>
          <div className={styles.headerActions}>
            <Badge variant={getLifecycleStatusBadgeVariant(lifecycleStatus)}>
              {formatLifecycleStatus(lifecycleStatus)}
            </Badge>
            <Button variant="outline" asChild>
              <Link href={eventsPath}>Wróć do eventów</Link>
            </Button>
          </div>
        </header>

        {actionMessage ? (
          <Alert className={styles.successMessage} role="status">
            <AlertDescription>{actionMessage}</AlertDescription>
          </Alert>
        ) : null}

        <div className={styles.organizationList}>
          <Card>
            <CardHeader>
              <CardTitle>Szczegóły wydarzenia</CardTitle>
              <CardDescription>
                Panel zarządzania godziną zamknięcia i ręcznym zakończeniem
                wydarzenia.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className={styles.eventDetails}>
                <div>
                  <dt>Status</dt>
                  <dd>{formatLifecycleStatus(lifecycleStatus)}</dd>
                </div>
                <div>
                  <dt>Zgłoszenia</dt>
                  <dd>{requestsOpen ? "Otwarte" : "Zamknięte"}</dd>
                </div>
                <div>
                  <dt>Start</dt>
                  <dd>{formatDateTime(result.event.startsAt)}</dd>
                </div>
                <div>
                  <dt>Czas zamknięcia</dt>
                  <dd>{formatDateTime(result.event.autoCloseAt)}</dd>
                </div>
                <div>
                  <dt>Publiczny event</dt>
                  <dd>{result.event.isActivePublicEvent ? "Tak" : "Nie"}</dd>
                </div>
                <div>
                  <dt>Publiczna kolejka</dt>
                  <dd>{result.event.publicQueueEnabled ? "Włączona" : "Wyłączona"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Link sesji</CardTitle>
              <CardDescription>
                Link sesji zostanie dodany w kolejnym etapie.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {result.event.facebookUrl ? (
                <p className={styles.eventMeta}>
                  Facebook:{" "}
                  <a
                    className={styles.inlineLink}
                    href={result.event.facebookUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Otwórz wydarzenie na Facebooku
                  </a>
                </p>
              ) : (
                <p className={styles.eventMeta}>
                  Facebook URL nie został ustawiony.
                </p>
              )}
            </CardContent>
          </Card>

          <EventManagementPanel
            canManage={canManage}
            manageBlockedReason={getManageBlockedReason({
              roleCanManage,
              lifecycleStatus,
            })}
            autoCloseAtInputValue={formatDateTimeLocalInput(
              result.event.autoCloseAt,
            )}
            showClosingWarning={shouldShowDashboardEventClosingWarning(
              result.event,
              now,
            )}
            updateAutoCloseAtAction={updateEventAutoCloseAt.bind(
              null,
              result.organization.publicId,
              result.event.id,
              result.event.startsAt.toISOString(),
            )}
            extendAction={extendEvent.bind(
              null,
              result.organization.publicId,
              result.event.id,
            )}
            closeAction={closeEvent.bind(
              null,
              result.organization.publicId,
              result.event.id,
            )}
          />
        </div>
      </section>
    </main>
  );
}

async function updateEventAutoCloseAt(
  organizationId: string,
  eventId: number,
  startsAtIso: string,
  _state: EventManagementActionState,
  formData: FormData,
): Promise<EventManagementActionState> {
  "use server";

  const validation = validateUpdateDashboardEventAutoCloseAtInput(
    {
      autoCloseAt: formData.get("autoCloseAt"),
    },
    new Date(startsAtIso),
  );

  if (!validation.success) {
    return {
      issues: validation.issues,
      message: "Popraw czas zamknięcia wydarzenia.",
    };
  }

  const session = await requireOperatorSession();

  try {
    const result = await updateDashboardOrganizationEventAutoCloseAtForAuthUser({
      authUserId: session.authUser.id,
      organizationId,
      eventId,
      event: validation.data,
    });
    const path = getDashboardOrganizationEventPath(
      result.organization.publicId,
      result.event.id,
    );

    revalidatePath(path);
    redirect(`${path}?eventAction=close-time-updated`);
  } catch (error) {
    return mapEventManagementActionError(error);
  }
}

async function extendEvent(
  organizationId: string,
  eventId: number,
  _state: EventManagementActionState,
  formData: FormData,
): Promise<EventManagementActionState> {
  "use server";

  const validation = validateExtendDashboardEventInput({
    minutes: formData.get("minutes"),
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
    const path = getDashboardOrganizationEventPath(
      result.organization.publicId,
      result.event.id,
    );

    revalidatePath(path);
    redirect(`${path}?eventAction=extended`);
  } catch (error) {
    return mapEventManagementActionError(error);
  }
}

async function closeEvent(
  organizationId: string,
  eventId: number,
): Promise<EventManagementActionState> {
  "use server";

  const session = await requireOperatorSession();

  try {
    const result = await closeDashboardOrganizationEventForAuthUser({
      authUserId: session.authUser.id,
      organizationId,
      eventId,
    });
    const path = getDashboardOrganizationEventPath(
      result.organization.publicId,
      result.event.id,
    );

    revalidatePath(path);
    redirect(`${path}?eventAction=closed`);
  } catch (error) {
    return mapEventManagementActionError(error);
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
      return {
        ...emptyActionState,
        message:
          "To wydarzenie jest już zamknięte albo anulowane. W MVP nie otwieramy go ponownie.",
      };
    }

    if (error.status === 400) {
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
    return "Wydarzenie jest zamknięte, więc w MVP nie otwieramy go ponownie przez zmianę czasu zamknięcia.";
  }

  return "Zarządzanie tym wydarzeniem jest obecnie niedostępne.";
}

function getActionMessage(value: string | string[] | undefined) {
  const action = Array.isArray(value) ? value[0] : value;

  switch (action as EventAction | undefined) {
    case "close-time-updated":
      return "Czas zamknięcia wydarzenia został zapisany.";
    case "extended":
      return "Wydarzenie zostało wydłużone.";
    case "closed":
      return "Wydarzenie zostało zamknięte.";
    default:
      return null;
  }
}

function formatDateTime(date: Date | null) {
  if (!date) {
    return "Brak terminu";
  }

  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDateTimeLocalInput(date: Date | null) {
  if (!date) {
    return "";
  }

  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);

  return localDate.toISOString().slice(0, 16);
}
