"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

import {
  createDashboardEventAccessLink,
  getDashboardEventAccessLinks,
  OperatorClientError,
  revokeDashboardEventAccessLink,
  type CreateDashboardEventAccessLinkResponse,
  type DashboardEventAccessLink,
} from "./api";
import styles from "./operator.module.css";

type CreatedAccessLinkSecret = Pick<
  CreateDashboardEventAccessLinkResponse,
  "code" | "sessionPath"
> & {
  linkId: number;
};

export function EventAccessLinksPanel() {
  const router = useRouter();
  const [links, setLinks] = useState<DashboardEventAccessLink[]>([]);
  const [label, setLabel] = useState("");
  const [createdSecret, setCreatedSecret] =
    useState<CreatedAccessLinkSecret | null>(null);
  const [revokeTarget, setRevokeTarget] =
    useState<DashboardEventAccessLink | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAuthenticationError = useCallback(
    (caughtError: unknown) => {
      if (
        caughtError instanceof OperatorClientError &&
        caughtError.status === 401
      ) {
        router.replace("/sign-in");
        router.refresh();
        return true;
      }

      return false;
    },
    [router],
  );

  const loadLinks = useCallback(async () => {
    const response = await getDashboardEventAccessLinks();
    setLinks(response.links);
  }, []);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const response = await getDashboardEventAccessLinks();

        if (active) {
          setLinks(response.links);
        }
      } catch (caughtError) {
        if (active && !handleAuthenticationError(caughtError)) {
          setError(getAccessLinksErrorMessage(caughtError));
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, [handleAuthenticationError]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActiveAction("create");
    setCreatedSecret(null);
    setError(null);

    try {
      const response = await createDashboardEventAccessLink(
        label.trim() || null,
      );

      setLinks((currentLinks) => [
        response.link,
        ...currentLinks.filter((link) => link.id !== response.link.id),
      ]);
      setCreatedSecret({
        linkId: response.link.id,
        code: response.code,
        sessionPath: response.sessionPath,
      });
      setLabel("");
    } catch (caughtError) {
      if (!handleAuthenticationError(caughtError)) {
        setError(getAccessLinksErrorMessage(caughtError));
      }
    } finally {
      setActiveAction(null);
    }
  }

  async function handleRefresh() {
    setActiveAction("refresh");
    setCreatedSecret(null);
    setError(null);

    try {
      await loadLinks();
    } catch (caughtError) {
      if (!handleAuthenticationError(caughtError)) {
        setError(getAccessLinksErrorMessage(caughtError));
      }
    } finally {
      setActiveAction(null);
    }
  }

  async function handleConfirmRevoke() {
    if (!revokeTarget) {
      return;
    }

    const linkId = revokeTarget.id;
    setActiveAction(`revoke:${linkId}`);
    setError(null);

    try {
      const response = await revokeDashboardEventAccessLink(linkId);

      setLinks((currentLinks) =>
        currentLinks.map((link) =>
          link.id === response.link.id ? response.link : link,
        ),
      );
      setCreatedSecret((currentSecret) =>
        currentSecret?.linkId === linkId ? null : currentSecret,
      );
      setRevokeTarget(null);
      await loadLinks();
    } catch (caughtError) {
      if (!handleAuthenticationError(caughtError)) {
        setError(getAccessLinksErrorMessage(caughtError));
      }
    } finally {
      setActiveAction(null);
    }
  }

  const isBusy = activeAction !== null;
  const isRevoking = activeAction?.startsWith("revoke:") ?? false;

  return (
    <>
      <Card className={styles.settingsCard}>
        <CardHeader>
          <CardTitle>Linki dostępu do eventu</CardTitle>
          <CardDescription>
            Twórz i unieważniaj linki, które później mogą zostać użyte w kodach
            QR i sesjach uczestników.
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleRefresh()}
              disabled={isBusy || isLoading}
            >
              {activeAction === "refresh" ? "Odświeżanie…" : "Odśwież"}
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <form className="flex flex-col gap-3" onSubmit={handleCreate}>
            <div className={styles.dashboardField}>
              <Label htmlFor="event-access-link-label">
                Etykieta (opcjonalnie)
              </Label>
              <Input
                id="event-access-link-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={120}
                placeholder="np. stolik przy wejściu"
                disabled={isBusy}
              />
            </div>
            <Button type="submit" disabled={isBusy}>
              {activeAction === "create"
                ? "Tworzenie…"
                : "Utwórz link dostępu"}
            </Button>
          </form>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Nie udało się wykonać operacji</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {createdSecret ? (
            <Alert>
              <AlertTitle>Nowy link został utworzony</AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <span>
                  Kod jest widoczny tylko teraz. Po odświeżeniu strony nie
                  będzie można go odzyskać.
                </span>
                <span className="flex flex-col gap-1">
                  <strong>Kod</strong>
                  <code className="break-all font-mono">
                    {createdSecret.code}
                  </code>
                </span>
                <span className="flex flex-col gap-1">
                  <strong>Ścieżka sesji</strong>
                  <code className="break-all font-mono">
                    {createdSecret.sessionPath}
                  </code>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreatedSecret(null)}
                  disabled={isBusy}
                >
                  Ukryj kod
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          <Separator />

          {isLoading ? (
            <p className="text-sm text-muted-foreground" role="status">
              Ładowanie linków dostępu…
            </p>
          ) : links.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ten event nie ma jeszcze linków dostępu.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {links.map((link, index) => {
                const status = getAccessLinkStatus(link);

                return (
                  <Fragment key={link.id}>
                    {index > 0 ? <Separator /> : null}
                    <article className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-medium">
                            {link.label || "Link bez etykiety"}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            Utworzony {formatDateTime(link.createdAt)}
                          </p>
                        </div>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </div>

                      <dl className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            Użycia
                          </dt>
                          <dd>{link.useCount}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            Ostatnie użycie
                          </dt>
                          <dd>{formatDateTime(link.lastUsedAt)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            Unieważniony
                          </dt>
                          <dd>{formatDateTime(link.revokedAt)}</dd>
                        </div>
                      </dl>

                      {link.active && !link.revokedAt ? (
                        <div>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => setRevokeTarget(link)}
                            disabled={isBusy}
                          >
                            Unieważnij link
                          </Button>
                        </div>
                      ) : null}
                    </article>
                  </Fragment>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isRevoking) {
            setRevokeTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unieważnić link dostępu?</AlertDialogTitle>
            <AlertDialogDescription>
              Link „{revokeTarget?.label || "bez etykiety"}” przestanie być
              aktywny. Stary kod nie zostanie przekierowany do innego linku.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRevoking}>Anuluj</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleConfirmRevoke()}
              disabled={isRevoking}
            >
              {isRevoking ? "Unieważnianie…" : "Tak, unieważnij link"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function getAccessLinkStatus(link: DashboardEventAccessLink): {
  label: string;
  variant: "default" | "secondary" | "destructive";
} {
  if (link.revokedAt) {
    return { label: "Unieważniony", variant: "destructive" };
  }

  if (link.active) {
    return { label: "Aktywny", variant: "default" };
  }

  return { label: "Nieaktywny", variant: "secondary" };
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getAccessLinksErrorMessage(error: unknown) {
  if (error instanceof OperatorClientError) {
    if (error.status === 400) {
      return "Sprawdź etykietę linku.";
    }

    if (error.status === 404) {
      return "Brak aktywnego eventu. Odśwież stronę.";
    }

    if (error.status === 409) {
      return "Link został już unieważniony. Odśwież listę.";
    }
  }

  return "Nie udało się wykonać operacji. Spróbuj ponownie.";
}
