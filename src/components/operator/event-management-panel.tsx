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

import styles from "./operator.module.css";

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
        <Alert className={styles.eventWarning}>
          <AlertTitle>
            Wydarzenie kończy się za mniej niż 30 minut. Wydłużyć?
          </AlertTitle>
          <AlertDescription>
            <form className={styles.warningActions} action={extendFormAction}>
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
          <form className={styles.settingsForm} action={detailsFormAction}>
            <ActionMessage state={detailsState} />

            <div className={styles.dashboardField}>
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

            <div className={styles.dashboardField}>
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

            <div className={styles.dashboardField}>
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

            <div className={styles.dashboardField}>
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

            <div className={styles.dashboardField}>
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
              <p className={styles.eventMeta}>
                Jeśli zostawisz puste, czas zamknięcia zostanie ustawiony na 6
                godzin po starcie.
              </p>
              <FieldIssue state={detailsState} field="autoCloseAt" />
            </div>

            <div className={styles.dashboardField}>
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

            <div className={styles.formSection}>
              <h2>Katalog publiczny</h2>
              <div className={styles.dashboardField}>
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
                <p className={styles.eventMeta}>
                  Zostaw puste, aby wygenerować slug z nazwy przy publikacji.
                </p>
                <FieldIssue state={detailsState} field="slug" />
              </div>

              <label className={styles.checkboxField}>
                <input
                  name="visibility"
                  type="checkbox"
                  value="public"
                  defaultChecked={initialValues.visibility === "public"}
                />
                <span>Opublikuj w katalogu wydarzeń</span>
              </label>
              <p className={styles.eventMeta}>
                Publiczne wydarzenie wymaga sluga i daty publikacji. Wyłączenie
                publikacji nie usuwa historii pierwszej publikacji.
              </p>
              <FieldIssue state={detailsState} field="visibility" />
            </div>

            <div className={styles.formSection}>
              <h2>Widoczność i kolejka publiczna</h2>
              <label className={styles.checkboxField}>
                <input
                  name="publicQueueEnabled"
                  type="checkbox"
                  defaultChecked={initialValues.publicQueueEnabled}
                />
                <span>Publiczna kolejka włączona</span>
              </label>
              <p className={styles.eventMeta}>
                Decyduje, czy ludzie mogą korzystać z publicznego widoku kolejki
                dla tego wydarzenia.
              </p>

              <label className={styles.checkboxField}>
                <input
                  name="publicShowSongTitles"
                  type="checkbox"
                  defaultChecked={initialValues.publicShowSongTitles}
                />
                <span>Pokazuj tytuły piosenek publicznie</span>
              </label>
              <p className={styles.eventMeta}>
                Decyduje, czy publicznie widać tytuły zgłoszeń, czy tylko osoby
                i statusy.
              </p>

              <label className={styles.checkboxField}>
                <input
                  name="isActivePublicEvent"
                  type="checkbox"
                  defaultChecked={initialValues.isActivePublicEvent}
                />
                <span>Event aktywny publicznie</span>
              </label>
              <p className={styles.eventMeta}>
                Ten event jest używany przez publiczny widok /queue. Organizacja
                może mieć tylko jeden aktywny publicznie event.
              </p>
              <FieldIssue state={detailsState} field="isActivePublicEvent" />
            </div>

            <div className={styles.formActions}>
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
          <form className={styles.settingsForm} action={extendFormAction}>
            <ActionMessage state={extendState} />
            <div className={styles.lifecycleActions}>
              <ExtendButtons disabled={isExtending} />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className={styles.dangerZoneCard}>
        <CardHeader>
          <CardTitle>Zamknięcie wydarzenia</CardTitle>
          <CardDescription>
            Zamknięcie ustawia status wydarzenia na zamknięty i nie usuwa
            żadnych danych.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className={styles.settingsForm} action={closeFormAction}>
            <ActionMessage state={closeState} />
            <div className={styles.formActions}>
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
    <p className={styles.formError} role="alert">
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

  return issue ? <p className={styles.fieldError}>{issue.message}</p> : null;
}

function hasIssue(state: EventManagementActionState, field: string) {
  return state.issues.some((issue) => issue.field === field);
}
