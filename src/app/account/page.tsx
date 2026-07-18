import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { sanitizeAuthIdentities } from "@/server/operator-api/account";
import {
  getOperatorDisplayName,
  requireOperatorSession,
} from "@/server/operator-api/supabase-session";

export const metadata: Metadata = {
  title: "Moje konto | Poza Nutą",
};

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await requireOperatorSession("account.profile");
  const {
    data: { user },
  } = await session.supabase.auth.getUser();
  const identities = sanitizeAuthIdentities(user?.identities);

  return (
    <div className={"min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground"}>
      <section className={"mx-auto w-full min-w-0 max-w-[72rem]"}>
        <header className={"mb-4 flex min-w-0 flex-col gap-4 py-1 sm:flex-row sm:items-center sm:justify-between [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight lg:[&_h1]:text-3xl"}>
          <div>
            <h1>Moje konto</h1>
            <p className={"mt-1.5 text-sm text-muted-foreground"}>
              Dane logowania z Supabase Auth i lokalnego operatora.
            </p>
          </div>
        </header>

        <div className={"grid min-w-0 gap-4"}>
          <Card>
            <CardHeader>
              <CardTitle>Profil użytkownika</CardTitle>
              <CardDescription>
                Dane tylko do odczytu. Edycja profilu będzie dostępna w
                późniejszym etapie.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className={"grid grid-cols-1 gap-3 sm:grid-cols-2 [&_div]:rounded-md [&_div]:bg-muted/40 [&_div]:p-3 [&_dt]:text-xs [&_dt]:font-semibold [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:text-sm [&_dd]:font-semibold"}>
                <div>
                  <dt>Email</dt>
                  <dd>{session.authUser.email ?? "Brak emaila"}</dd>
                </div>
                <div>
                  <dt>Auth user ID</dt>
                  <dd className={"min-w-0 break-all [overflow-wrap:anywhere]"}>{session.authUser.id}</dd>
                </div>
                <div>
                  <dt>Imię i nazwisko</dt>
                  <dd>{getOperatorDisplayName(session.operator)}</dd>
                </div>
                <div>
                  <dt>Techniczna nazwa operatora</dt>
                  <dd>{session.operator.name}</dd>
                </div>
                <div>
                  <dt>Status operatora</dt>
                  <dd>
                    <Badge>
                      {session.operator.active ? "Aktywny" : "Nieaktywny"}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt>Lokalny operator ID</dt>
                  <dd>{session.operator.id}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Metody logowania</CardTitle>
              <CardDescription>
                Widok techniczny aktualnych metod Supabase Auth. Tokeny i
                sekrety nie są wyświetlane.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {identities.length > 0 ? (
                <div className={"grid gap-3"}>
                  {identities.map((identity, index) => (
                    <div
                      className={"grid gap-3 rounded-md bg-muted/40 p-3 [&_dl]:grid [&_dl]:gap-2 [&_dt]:text-xs [&_dt]:font-semibold [&_dt]:text-muted-foreground [&_dd]:mt-0.5 [&_dd]:text-sm"}
                      key={`${identity.provider}-${identity.identityId ?? index}`}
                    >
                      <Badge>{identity.provider}</Badge>
                      <dl>
                        <div>
                          <dt>Identity ID</dt>
                          <dd className={"min-w-0 break-all [overflow-wrap:anywhere]"}>
                            {identity.identityId ?? identity.id ?? "Brak"}
                          </dd>
                        </div>
                        <div>
                          <dt>Utworzono</dt>
                          <dd>{identity.createdAt ?? "Brak danych"}</dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={"mt-1.5 text-sm text-muted-foreground"}>
                  Supabase nie zwrócił listy metod logowania.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
