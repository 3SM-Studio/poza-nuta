"use client";

import { useActionState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DASHBOARD_EVENT_EXTENSION_MINUTES } from "@/lib/dashboard-event-lifecycle";


export type EventManagementActionIssue = {
  field: string;
  message: string;
};

export type EventManagementActionState = {
  issues: EventManagementActionIssue[];
  message: string | null;
};

export type EventManagementAction = (
  state: EventManagementActionState,
  formData: FormData,
) => Promise<EventManagementActionState>;

export type EventManagementInitialValues = {
  title: string;
  venue: string;
  city: string;
  slug: string;
  visibility: "private" | "public";
  startsAtInputValue: string;
  autoCloseAtInputValue: string;
  facebookUrl: string;
  songRequestsEnabled: boolean;
  publicQueueEnabled: boolean;
  publicShowSongTitles: boolean;
  isActivePublicEvent: boolean;
};

const initialState: EventManagementActionState = {
  issues: [],
  message: null,
};

export function EventManagementPanel({
  canManage,
  manageBlockedReason,
  initialValues,
  showClosingWarning,
  detailsAction,
  extendAction,
  closeAction,
}: {
  canManage: boolean;
  manageBlockedReason: string;
  initialValues: EventManagementInitialValues;
  showClosingWarning: boolean;
  detailsAction: EventManagementAction;
  extendAction: EventManagementAction;
  closeAction: EventManagementAction;
}) {
  const [detailsState, detailsFormAction, isSavingDetails] = useActionState(
    detailsAction,
    initialState,
  );
  const [extendState, extendFormAction, isExtending] = useActionState(
    extendAction,
    initialState,
  );
  const [closeState, closeFormAction, isClosing] = useActionState(
    closeAction,
    initialState,
  );

  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Zarządzanie wydarzeniem</CardTitle>
          <CardDescription>{manageBlockedReason}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      {showClosingWarning ? (
        <Alert className={"mb-4"}>
          <AlertTitle>
            Wydarzenie kończy się za mniej niż 30 minut. Wydłużyć?
          </AlertTitle>
          <AlertDescription>
            <form className={"flex flex-wrap gap-2"} action={extendFormAction}>
              <ExtendButtons disabled={isExtending} />
            </form>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Szczegóły i widoczność</CardTitle>
          <CardDescription>
            Te ustawienia kontrolują harmonogram wydarzenia oraz to, czy jest
            ono używane przez publiczny widok kolejki.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className={"grid gap-4 [&_button]:justify-self-start"} action={detailsFormAction}>
            <ActionMessage state={detailsState} />

            <div className={"grid gap-2 [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
              <label htmlFor="event-manage-title">Nazwa wydarzenia</label>
              <input
                id="event-manage-title"
                name="title"
                type="text"
                required
                maxLength={120}
                defaultValue={initialValues.title}
                aria-invalid={hasIssue(detailsState, "title") || undefined}
              />
              <FieldIssue state={detailsState} field="title" />
            </div>

            <div className={"grid gap-2 [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
              <label htmlFor="event-manage-venue">Miejsce</label>
              <input
                id="event-manage-venue"
                name="venue"
                type="text"
                maxLength={120}
                defaultValue={initialValues.venue}
                aria-invalid={hasIssue(detailsState, "venue") || undefined}
              />
              <FieldIssue state={detailsState} field="venue" />
            </div>

            <div className={"grid gap-2 [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
              <label htmlFor="event-manage-city">Miasto</label>
              <input
                id="event-manage-city"
                name="city"
                type="text"
                maxLength={120}
                defaultValue={initialValues.city}
                aria-invalid={hasIssue(detailsState, "city") || undefined}
              />
              <FieldIssue state={detailsState} field="city" />
            </div>

            <div className={"grid gap-2 [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
              <label htmlFor="event-manage-starts-at">
                Start wydarzenia (czas polski)
              </label>
              <input
                id="event-manage-starts-at"
                name="startsAt"
                type="datetime-local"
                required
                defaultValue={initialValues.startsAtInputValue}
                aria-invalid={hasIssue(detailsState, "startsAt") || undefined}
              />
              <FieldIssue state={detailsState} field="startsAt" />
            </div>

            <div className={"grid gap-2 [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
              <label htmlFor="event-manage-auto-close-at">
                Czas zamknięcia (czas polski)
              </label>
              <input
                id="event-manage-auto-close-at"
                name="autoCloseAt"
                type="datetime-local"
                defaultValue={initialValues.autoCloseAtInputValue}
                aria-invalid={hasIssue(detailsState, "autoCloseAt") || undefined}
              />
              <p className={"mt-1.5 text-sm text-muted-foreground"}>
                Jeśli zostawisz puste, czas zamknięcia zostanie ustawiony na 6
                godzin po starcie.
              </p>
              <FieldIssue state={detailsState} field="autoCloseAt" />
            </div>

            <div className={"grid gap-2 [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
              <label htmlFor="event-manage-facebook-url">Facebook URL</label>
              <input
                id="event-manage-facebook-url"
                name="facebookUrl"
                type="url"
                defaultValue={initialValues.facebookUrl}
                placeholder="https://www.facebook.com/events/..."
                aria-invalid={hasIssue(detailsState, "facebookUrl") || undefined}
              />
              <FieldIssue state={detailsState} field="facebookUrl" />
            </div>

            <div className={"grid min-w-0 gap-3 rounded-md border border-border bg-muted/30 p-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:leading-snug"}>
              <h2>Katalog publiczny</h2>
              <div className={"grid gap-2 [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
                <label htmlFor="event-manage-slug">Slug publiczny</label>
                <input
                  id="event-manage-slug"
                  name="slug"
                  type="text"
                  inputMode="url"
                  maxLength={80}
                  defaultValue={initialValues.slug}
                  aria-invalid={hasIssue(detailsState, "slug") || undefined}
                />
                <p className={"mt-1.5 text-sm text-muted-foreground"}>
                  Zostaw puste, aby wygenerować slug z nazwy przy publikacji.
                </p>
                <FieldIssue state={detailsState} field="slug" />
              </div>

              <label className={"flex items-center gap-3 text-sm font-semibold [&_input]:size-5 [&_input]:accent-primary"}>
                <input
                  name="visibility"
                  type="checkbox"
                  value="public"
                  defaultChecked={initialValues.visibility === "public"}
                />
                <span>Opublikuj w katalogu wydarzeń</span>
              </label>
              <p className={"mt-1.5 text-sm text-muted-foreground"}>
                Publiczne wydarzenie wymaga sluga i daty publikacji. Wyłączenie
                publikacji nie usuwa historii pierwszej publikacji.
              </p>
              <FieldIssue state={detailsState} field="visibility" />
            </div>

            <div className={"grid min-w-0 gap-3 rounded-md border border-border bg-muted/30 p-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:leading-snug"}>
              <h2>Widoczność i kolejka publiczna</h2>
              <label className={"flex items-center gap-3 text-sm font-semibold [&_input]:size-5 [&_input]:accent-primary"}>
                <input
                  name="songRequestsEnabled"
                  type="checkbox"
                  defaultChecked={initialValues.songRequestsEnabled}
                />
                <span>Publiczne zgłoszenia włączone</span>
              </label>
              <p className={"mt-1.5 text-sm text-muted-foreground"}>
                Decyduje, czy publiczny endpoint wydarzenia przyjmuje nowe
                piosenki.
              </p>

              <label className={"flex items-center gap-3 text-sm font-semibold [&_input]:size-5 [&_input]:accent-primary"}>
                <input
                  name="publicQueueEnabled"
                  type="checkbox"
                  defaultChecked={initialValues.publicQueueEnabled}
                />
                <span>Publiczna kolejka włączona</span>
              </label>
              <p className={"mt-1.5 text-sm text-muted-foreground"}>
                Decyduje, czy ludzie mogą korzystać z publicznego widoku kolejki
                dla tego wydarzenia.
              </p>

              <label className={"flex items-center gap-3 text-sm font-semibold [&_input]:size-5 [&_input]:accent-primary"}>
                <input
                  name="publicShowSongTitles"
                  type="checkbox"
                  defaultChecked={initialValues.publicShowSongTitles}
                />
                <span>Pokazuj tytuły piosenek publicznie</span>
              </label>
              <p className={"mt-1.5 text-sm text-muted-foreground"}>
                Decyduje, czy publicznie widać tytuły zgłoszeń, czy tylko osoby
                i statusy.
              </p>

              <label className={"flex items-center gap-3 text-sm font-semibold [&_input]:size-5 [&_input]:accent-primary"}>
                <input
                  name="isActivePublicEvent"
                  type="checkbox"
                  defaultChecked={initialValues.isActivePublicEvent}
                />
                <span>Event aktywny publicznie</span>
              </label>
              <p className={"mt-1.5 text-sm text-muted-foreground"}>
                Ten event jest używany przez publiczny widok /queue. Organizacja
                może mieć tylko jeden aktywny publicznie event.
              </p>
              <FieldIssue state={detailsState} field="isActivePublicEvent" />
            </div>

            <div className={"flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&>*]:max-w-full"}>
              <Button type="submit" disabled={isSavingDetails}>
                {isSavingDetails ? "Zapisywanie..." : "Zapisz szczegóły"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Szybkie wydłużenie</CardTitle>
          <CardDescription>
            Wydłużamy względem późniejszej wartości: teraz albo obecnego czasu
            zamknięcia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className={"grid gap-4 [&_button]:justify-self-start"} action={extendFormAction}>
            <ActionMessage state={extendState} />
            <div className={"flex flex-wrap gap-2"}>
              <ExtendButtons disabled={isExtending} />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className={"border-destructive/40"}>
        <CardHeader>
          <CardTitle>Zamknięcie wydarzenia</CardTitle>
          <CardDescription>
            Zamknięcie ustawia status wydarzenia na zamknięty i nie usuwa
            żadnych danych.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className={"grid gap-4 [&_button]:justify-self-start"} action={closeFormAction}>
            <ActionMessage state={closeState} />
            <div className={"flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&>*]:max-w-full"}>
              <Button type="submit" variant="destructive" disabled={isClosing}>
                {isClosing ? "Zamykanie..." : "Zamknij wydarzenie teraz"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}

function ExtendButtons({ disabled }: { disabled: boolean }) {
  return (
    <>
      {DASHBOARD_EVENT_EXTENSION_MINUTES.map((minutes) => (
        <Button
          key={minutes}
          name="minutes"
          type="submit"
          value={minutes}
          variant="outline"
          disabled={disabled}
        >
          +{minutes} min
        </Button>
      ))}
    </>
  );
}

function ActionMessage({ state }: { state: EventManagementActionState }) {
  return state.message ? (
    <p className={"m-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm leading-relaxed text-destructive"} role="alert">
      {state.message}
    </p>
  ) : null;
}

function FieldIssue({
  state,
  field,
}: {
  state: EventManagementActionState;
  field: string;
}) {
  const issue = state.issues.find((item) => item.field === field);

  return issue ? <p className={"m-0 text-sm leading-snug text-destructive"}>{issue.message}</p> : null;
}

function hasIssue(state: EventManagementActionState, field: string) {
  return state.issues.some((issue) => issue.field === field);
}
