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
import { requireOperatorSession } from "@/server/operator-api/supabase-session";

export const metadata: Metadata = {
  title: "Bezpieczeństwo konta | Poza Nutą",
};

export const dynamic = "force-dynamic";

export default async function AccountSecurityPage() {
  const session = await requireOperatorSession("account.security");
  const {
    data: { user },
  } = await session.supabase.auth.getUser();
  const identities = sanitizeAuthIdentities(user?.identities);
  const hasEmailMethod =
    Boolean(session.authUser.email) ||
    identities.some((identity) => identity.provider === "email");

  return (
    <div className={"min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground"}>
      <section className={"mx-auto w-full min-w-0 max-w-[58rem]"}>
        <header className={"mb-4 flex min-w-0 flex-col gap-4 py-1 sm:flex-row sm:items-center sm:justify-between [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight lg:[&_h1]:text-3xl"}>
          <div>
            <h1>Bezpieczeństwo</h1>
            <p className={"mt-1.5 text-sm text-muted-foreground"}>
              Podgląd ustawień bezpieczeństwa konta operatora.
            </p>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Logowanie</CardTitle>
            <CardDescription>
              Aktualny stan metod logowania dla tego operatora. To jest widok
              tylko do odczytu.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className={"grid grid-cols-1 gap-3 sm:grid-cols-2 [&_div]:rounded-md [&_div]:bg-muted/40 [&_div]:p-3 [&_dt]:text-xs [&_dt]:font-semibold [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:text-sm [&_dd]:font-semibold"}>
              <div>
                <dt>Email</dt>
                <dd>{session.authUser.email ?? "Brak emaila"}</dd>
              </div>
              <div>
                <dt>Hasło / Email</dt>
                <dd>
                  <Badge variant={hasEmailMethod ? "default" : "secondary"}>
                    {hasEmailMethod ? "Aktywne" : "Nieustalone"}
                  </Badge>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Metody logowania</CardTitle>
            <CardDescription>
              Google OAuth, rozłączanie metod i MFA nie są implementowane w tym
              kroku.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className={"grid gap-3"}>
              {identities.length > 0 ? (
                identities.map((identity, index) => (
                  <div
                    className={"grid gap-3 rounded-md bg-muted/40 p-3 [&_dl]:grid [&_dl]:gap-2 [&_dt]:text-xs [&_dt]:font-semibold [&_dt]:text-muted-foreground [&_dd]:mt-0.5 [&_dd]:text-sm"}
                    key={`${identity.provider}-${identity.identityId ?? index}`}
                  >
                    <Badge>{formatProvider(identity.provider)}</Badge>
                    <dl>
                      <div>
                        <dt>Provider</dt>
                        <dd>{formatProvider(identity.provider)}</dd>
                      </div>
                      <div>
                        <dt>Utworzono</dt>
                        <dd>{identity.createdAt ?? "Brak danych"}</dd>
                      </div>
                    </dl>
                  </div>
                ))
              ) : (
                <p className={"mt-1.5 text-sm text-muted-foreground"}>
                  Supabase nie zwrócił listy aktywnych metod logowania.
                </p>
              )}

              <div className={"grid gap-3 rounded-md bg-muted/40 p-3 [&_dl]:grid [&_dl]:gap-2 [&_dt]:text-xs [&_dt]:font-semibold [&_dt]:text-muted-foreground [&_dd]:mt-0.5 [&_dd]:text-sm"}>
                <Badge variant="secondary">Google · Wkrótce</Badge>
                <p className={"mt-1.5 text-sm text-muted-foreground"}>
                  Łączenie konta Google zostanie dodane osobno. Ten ekran nie
                  uruchamia OAuth.
                </p>
              </div>

              <div className={"grid gap-3 rounded-md bg-muted/40 p-3 [&_dl]:grid [&_dl]:gap-2 [&_dt]:text-xs [&_dt]:font-semibold [&_dt]:text-muted-foreground [&_dd]:mt-0.5 [&_dd]:text-sm"}>
                <Badge variant="secondary">MFA · Wkrótce</Badge>
                <p className={"mt-1.5 text-sm text-muted-foreground"}>
                  Wieloskładnikowe logowanie zostanie zaprojektowane jako osobny
                  etap bezpieczeństwa.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function formatProvider(provider: string) {
  switch (provider) {
    case "email":
      return "Email";
    case "google":
      return "Google";
    default:
      return provider;
  }
}
