"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

import styles from "./operator.module.css";

export type CreateEventFormIssue = {
  field: string;
  message: string;
};

export type CreateEventFormState = {
  issues: CreateEventFormIssue[];
  message: string | null;
};

export type CreateEventFormAction = (
  state: CreateEventFormState,
  formData: FormData,
) => Promise<CreateEventFormState>;

const initialState: CreateEventFormState = {
  issues: [],
  message: null,
};

export function CreateEventForm({
  action,
  cancelPath,
}: {
  action: CreateEventFormAction;
  cancelPath: string;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form className={styles.settingsForm} action={formAction}>
      {state.message ? (
        <p className={styles.formError} role="alert">
          {state.message}
        </p>
      ) : null}

      <div className={styles.dashboardField}>
        <label htmlFor="event-title">Tytuł wydarzenia</label>
        <input
          id="event-title"
          name="title"
          type="text"
          required
          maxLength={120}
          aria-invalid={hasIssue(state, "title") || undefined}
        />
        <FieldIssue state={state} field="title" />
      </div>

      <div className={styles.dashboardField}>
        <label htmlFor="event-starts-at">Start wydarzenia</label>
        <input
          id="event-starts-at"
          name="startsAt"
          type="datetime-local"
          required
          aria-invalid={hasIssue(state, "startsAt") || undefined}
        />
        <FieldIssue state={state} field="startsAt" />
      </div>

      <div className={styles.dashboardField}>
        <label htmlFor="event-auto-close-at">Czas zamknięcia</label>
        <input
          id="event-auto-close-at"
          name="autoCloseAt"
          type="datetime-local"
          aria-invalid={hasIssue(state, "autoCloseAt") || undefined}
        />
        <p className={styles.eventMeta}>
          Jeśli zostawisz puste, wydarzenie zamknie przyjmowanie zgłoszeń po 6
          godzinach od startu.
        </p>
        <FieldIssue state={state} field="autoCloseAt" />
      </div>

      <div className={styles.dashboardField}>
        <label htmlFor="event-facebook-url">Facebook URL</label>
        <input
          id="event-facebook-url"
          name="facebookUrl"
          type="url"
          placeholder="https://www.facebook.com/events/..."
          aria-invalid={hasIssue(state, "facebookUrl") || undefined}
        />
        <FieldIssue state={state} field="facebookUrl" />
      </div>

      <div className={styles.formActions}>
        <Button variant="outline" asChild>
          <Link href={cancelPath}>Anuluj</Link>
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Tworzenie..." : "Utwórz wydarzenie"}
        </Button>
      </div>
    </form>
  );
}

function FieldIssue({
  state,
  field,
}: {
  state: CreateEventFormState;
  field: string;
}) {
  const issue = state.issues.find((item) => item.field === field);

  return issue ? <p className={styles.fieldError}>{issue.message}</p> : null;
}

function hasIssue(state: CreateEventFormState, field: string) {
  return state.issues.some((issue) => issue.field === field);
}
