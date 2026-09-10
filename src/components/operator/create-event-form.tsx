"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";


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
    <form className={"grid gap-4 [&_button]:justify-self-start"} action={formAction}>
      {state.message ? (
        <p className={"m-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm leading-relaxed text-destructive"} role="alert">
          {state.message}
        </p>
      ) : null}

      <div className={"grid gap-2 [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
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

      <div className={"grid gap-2 [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
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

      <div className={"grid gap-2 [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
        <label htmlFor="event-starts-at">Start wydarzenia (czas polski)</label>
        <input
          id="event-starts-at"
          name="startsAt"
          type="datetime-local"
          required
          aria-invalid={hasIssue(state, "startsAt") || undefined}
        />
        <FieldIssue state={state} field="startsAt" />
      </div>

      <div className={"grid gap-2 [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
        <label htmlFor="event-auto-close-at">
          Czas zamknięcia (czas polski)
        </label>
        <input
          id="event-auto-close-at"
          name="autoCloseAt"
          type="datetime-local"
          aria-invalid={hasIssue(state, "autoCloseAt") || undefined}
        />
        <p className={"mt-1.5 text-sm text-muted-foreground"}>
          Jeśli zostawisz puste, wydarzenie zamknie przyjmowanie zgłoszeń po 6
          godzinach od startu.
        </p>
        <FieldIssue state={state} field="autoCloseAt" />
      </div>

      <div className={"grid gap-2 [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:outline-none focus-within:[&_input]:border-ring focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-ring/30"}>
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

      <div className={"grid min-w-0 gap-3 rounded-md border border-border bg-muted/30 p-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:leading-snug"}>
        <h2>Widoczność i kolejka publiczna</h2>
        <label className={"flex items-center gap-3 text-sm font-semibold [&_input]:size-5 [&_input]:accent-primary"}>
          <input name="songRequestsEnabled" type="checkbox" />
          <span>Publiczne zgłoszenia włączone</span>
        </label>
        <p className={"mt-1.5 text-sm text-muted-foreground"}>
          Decyduje, czy publiczny endpoint wydarzenia przyjmuje nowe piosenki.
        </p>

        <label className={"flex items-center gap-3 text-sm font-semibold [&_input]:size-5 [&_input]:accent-primary"}>
          <input name="publicQueueEnabled" type="checkbox" />
          <span>Publiczna kolejka włączona</span>
        </label>
        <p className={"mt-1.5 text-sm text-muted-foreground"}>
          Decyduje, czy publiczny widok kolejki może pokazywać zgłoszenia dla
          tego wydarzenia.
        </p>

        <label className={"flex items-center gap-3 text-sm font-semibold [&_input]:size-5 [&_input]:accent-primary"}>
          <input name="publicShowSongTitles" type="checkbox" defaultChecked />
          <span>Pokazuj tytuły piosenek publicznie</span>
        </label>
        <p className={"mt-1.5 text-sm text-muted-foreground"}>
          Gdy wyłączone, publiczna kolejka pokazuje osoby i statusy bez tytułów
          utworów.
        </p>

        <label className={"flex items-center gap-3 text-sm font-semibold [&_input]:size-5 [&_input]:accent-primary"}>
          <input name="isActivePublicEvent" type="checkbox" />
          <span>Event aktywny publicznie</span>
        </label>
        <p className={"mt-1.5 text-sm text-muted-foreground"}>
          Ten event będzie używany przez publiczny widok /queue. W organizacji
          może być tylko jeden taki event.
        </p>
        <FieldIssue state={state} field="isActivePublicEvent" />
      </div>

      <div className={"flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&>*]:max-w-full"}>
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

  return issue ? <p className={"m-0 text-sm leading-snug text-destructive"}>{issue.message}</p> : null;
}

function hasIssue(state: CreateEventFormState, field: string) {
  return state.issues.some((issue) => issue.field === field);
}
