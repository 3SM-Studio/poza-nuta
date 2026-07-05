"use client";

import { useActionState, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import styles from "./operator.module.css";

export type EventSessionLinkActionState = {
  message: string | null;
  sessionUrl: string | null;
  success: boolean;
};

export type EventSessionLinkAction = (
  state: EventSessionLinkActionState,
  formData: FormData,
) => Promise<EventSessionLinkActionState>;

export type EventSessionLinkSummary = {
  createdAt: string;
  lastUsedAt: string | null;
  useCount: number;
} | null;

const initialState: EventSessionLinkActionState = {
  message: null,
  sessionUrl: null,
  success: false,
};

export function EventSessionLinkPanel({
  canManage,
  activeLink,
  action,
}: {
  canManage: boolean;
  activeLink: EventSessionLinkSummary;
  action: EventSessionLinkAction;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const hasActiveLink = Boolean(activeLink) || Boolean(state.sessionUrl);

  async function copySessionUrl() {
    if (!state.sessionUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(state.sessionUrl);
      setCopyMessage("Link skopiowany.");
    } catch {
      setCopyMessage("Nie udało się skopiować linku automatycznie.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Link sesji</CardTitle>
        <CardDescription>
          Pełny link jest widoczny tylko po wygenerowaniu. W razie potrzeby
          wygeneruj nowy.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className={styles.settingsForm}>
          {hasActiveLink ? (
            <p className={styles.eventMeta}>Link sesji jest aktywny.</p>
          ) : (
            <p className={styles.eventMeta}>
              Ten event nie ma jeszcze aktywnego linku sesji.
            </p>
          )}

          {activeLink ? (
            <dl className={styles.eventDetails}>
              <div>
                <dt>Utworzony</dt>
                <dd>{formatDateTime(activeLink.createdAt)}</dd>
              </div>
              <div>
                <dt>Użycia</dt>
                <dd>{activeLink.useCount}</dd>
              </div>
              <div>
                <dt>Ostatnie użycie</dt>
                <dd>
                  {activeLink.lastUsedAt
                    ? formatDateTime(activeLink.lastUsedAt)
                    : "Brak"}
                </dd>
              </div>
            </dl>
          ) : null}

          {state.message ? (
            <Alert variant={state.success ? "default" : "destructive"}>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : null}

          {state.sessionUrl ? (
            <div className={styles.formSection}>
              <h2>Nowy link</h2>
              <p className={styles.breakValue}>{state.sessionUrl}</p>
              <div className={styles.formActions}>
                <Button
                  variant="outline"
                  type="button"
                  onClick={copySessionUrl}
                >
                  Kopiuj link
                </Button>
              </div>
              {copyMessage ? (
                <p className={styles.eventMeta} role="status">
                  {copyMessage}
                </p>
              ) : null}
            </div>
          ) : null}

          {canManage ? (
            <form action={formAction}>
              <Button type="submit" disabled={isPending}>
                {isPending
                  ? "Generowanie..."
                  : hasActiveLink
                    ? "Regeneruj link"
                    : "Wygeneruj link sesji"}
              </Button>
            </form>
          ) : (
            <p className={styles.eventMeta}>
              Linkiem sesji zarządza owner albo manager organizacji.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
