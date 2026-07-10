import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { EventManagementPanel } from "@/components/operator/event-management-panel";
import type { EventManagementActionState } from "@/components/operator/event-management-panel";
import { EventSessionLinkPanel } from "@/components/operator/event-session-link-panel";
import type { EventSessionLinkActionState } from "@/components/operator/event-session-link-panel";
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
  getDashboardOrganizationEventQueuePath,
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
  generateDashboardOrganizationEventSessionLinkForAuthUser,
  getDashboardOrganizationEventSessionLinkForAuthUser,
  updateDashboardOrganizationEventDetailsForAuthUser,
} from "@/server/operator-api/organizations";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";
import {
  validateEventId,
  validateExtendDashboardEventInput,
  validateUpdateDashboardEventDetailsInput,
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

type EventAction = "details-updated" | "extended" | "closed";

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
  const result = await getDashboardOrganizationEventSessionLinkForAuthUser({
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
  const queuePath = getDashboardOrganizationEventQueuePath(
    result.organization.publicId,
    result.event.id,
  );
  const sharePath = getDashboardOrganizationEventSharePath(
    result.organization.publicId,
    result.event.id,
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
            <Button asChild>
              <Link href={queuePath}>Zarządzaj kolejką</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={sharePath}>Link i QR</Link>
            </Button>
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
                  <dt>Publiczny URL</dt>
                  <dd>
                    {result.event.slug ? (
                      <Link
                        className={styles.inlineLink}
                        href={`/events/${result.event.slug}`}
                      >
                        /events/{result.event.slug}
                      </Link>
                    ) : (
                      "Nie ustawiono"
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Publiczna kolejka</dt>
                  <dd>{result.event.publicQueueEnabled ? "Włączona" : "Wyłączona"}</dd>
                </div>
                <div>
                  <dt>Facebook</dt>
                  <dd>
                    {result.event.facebookUrl ? (
                      <a
                        className={styles.inlineLink}
                        href={result.event.facebookUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Otwórz wydarzenie
                      </a>
                    ) : (
                      "Nie ustawiono"
                    )}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <EventSessionLinkPanel
            canManage={roleCanManage}
            activeLink={
              result.sessionLink
                ? {
                    createdAt: result.sessionLink.createdAt.toISOString(),
                    lastUsedAt:
                      result.sessionLink.lastUsedAt?.toISOString() ?? null,
                    useCount: result.sessionLink.useCount,
                  }
                : null
            }
            action={generateSessionLink.bind(
              null,
              result.organization.publicId,
              result.event.id,
            )}
          />
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
              result.event.id,
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

async function updateEventDetails(
  organizationId: string,
  eventId: number,
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
    const path = getDashboardOrganizationEventPath(
      result.organization.publicId,
      result.event.id,
    );

    revalidatePath(path);
    redirect(`${path}?eventAction=details-updated`);
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

async function generateSessionLink(
  organizationId: string,
  eventId: number,
  _state: EventSessionLinkActionState,
  _formData: FormData,
): Promise<EventSessionLinkActionState> {
  "use server";

  void _state;
  void _formData;

  const session = await requireOperatorSession();

  try {
    const result =
      await generateDashboardOrganizationEventSessionLinkForAuthUser({
        authUserId: session.authUser.id,
        organizationId,
        eventId,
      });
    const eventPath = getDashboardOrganizationEventPath(
      result.organization.publicId,
      result.event.id,
    );

    revalidatePath(eventPath);

    return {
      success: true,
      message:
        "Link sesji został wygenerowany. Poprzedni aktywny link, jeśli istniał, został unieważniony.",
      sessionUrl: await buildSessionUrl(result.sessionPath),
    };
  } catch (error) {
    if (error instanceof OperatorApiError) {
      if (error.status === 403) {
        return {
          success: false,
          message: "Nie masz uprawnień do generowania linku sesji.",
          sessionUrl: null,
        };
      }

      if (error.status === 404) {
        return {
          success: false,
          message: "Nie znaleziono wydarzenia albo organizacji.",
          sessionUrl: null,
        };
      }
    }

    throw error;
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
        message:
          "To wydarzenie jest już zamknięte albo anulowane. W MVP nie otwieramy go ponownie.",
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
    return "Wydarzenie jest zamknięte, więc w MVP nie otwieramy go ponownie przez zmianę czasu zamknięcia.";
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
    default:
      return null;
  }
}

async function buildSessionUrl(sessionPath: string) {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");

  if (!host) {
    return sessionPath;
  }

  const protocol =
    headerList.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  return `${protocol}://${host}${sessionPath}`;
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
