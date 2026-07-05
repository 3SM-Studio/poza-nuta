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
        <label htmlFor="event-venue">Miejsce</label>
        <input
          id="event-venue"
          name="venue"
          type="text"
          maxLength={120}
          placeholder="np. Klub Miejski"
          aria-invalid={hasIssue(state, "venue") || undefined}
        />
        <FieldIssue state={state} field="venue" />
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

      <div className={styles.formSection}>
        <h2>Widoczność i kolejka publiczna</h2>
        <label className={styles.checkboxField}>
          <input name="publicQueueEnabled" type="checkbox" />
          <span>Publiczna kolejka włączona</span>
        </label>
        <p className={styles.eventMeta}>
          Decyduje, czy publiczny widok kolejki może pokazywać zgłoszenia dla
          tego wydarzenia.
        </p>

        <label className={styles.checkboxField}>
          <input name="publicShowSongTitles" type="checkbox" defaultChecked />
          <span>Pokazuj tytuły piosenek publicznie</span>
        </label>
        <p className={styles.eventMeta}>
          Gdy wyłączone, publiczna kolejka pokazuje osoby i statusy bez tytułów
          utworów.
        </p>

        <label className={styles.checkboxField}>
          <input name="isActivePublicEvent" type="checkbox" />
          <span>Event aktywny publicznie</span>
        </label>
        <p className={styles.eventMeta}>
          Ten event będzie używany przez publiczny widok /queue. W organizacji
          może być tylko jeden taki event.
        </p>
        <FieldIssue state={state} field="isActivePublicEvent" />
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
