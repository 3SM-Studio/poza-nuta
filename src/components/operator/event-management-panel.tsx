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

const initialState: EventManagementActionState = {
  issues: [],
  message: null,
};

export function EventManagementPanel({
  canManage,
  manageBlockedReason,
  autoCloseAtInputValue,
  showClosingWarning,
  updateAutoCloseAtAction,
  extendAction,
  closeAction,
}: {
  canManage: boolean;
  manageBlockedReason: string;
  autoCloseAtInputValue: string;
  showClosingWarning: boolean;
  updateAutoCloseAtAction: EventManagementAction;
  extendAction: EventManagementAction;
  closeAction: EventManagementAction;
}) {
  const [updateState, updateFormAction, isUpdating] = useActionState(
    updateAutoCloseAtAction,
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
          <CardTitle>Czas zamknięcia</CardTitle>
          <CardDescription>
            Zmieniasz moment, po którym wydarzenie przestaje przyjmować
            zgłoszenia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className={styles.settingsForm} action={updateFormAction}>
            <ActionMessage state={updateState} />
            <div className={styles.dashboardField}>
              <label htmlFor="event-manage-auto-close-at">
                Nowy czas zamknięcia
              </label>
              <input
                id="event-manage-auto-close-at"
                name="autoCloseAt"
                type="datetime-local"
                required
                defaultValue={autoCloseAtInputValue}
                aria-invalid={hasIssue(updateState, "autoCloseAt") || undefined}
              />
              <FieldIssue state={updateState} field="autoCloseAt" />
            </div>
            <div className={styles.formActions}>
              <Button type="submit" disabled={isUpdating}>
                {isUpdating ? "Zapisywanie..." : "Zapisz czas zamknięcia"}
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
