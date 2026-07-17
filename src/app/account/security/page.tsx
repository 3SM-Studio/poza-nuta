import type { Metadata } from "next";

import styles from "@/components/operator/operator.module.css";
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
    <div className={styles.queuePage}>
      <section className={styles.settingsShell}>
        <header className={styles.pageHeader}>
          <div>
            <h1>Bezpieczeństwo</h1>
            <p className={styles.eventMeta}>
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
            <dl className={styles.eventDetails}>
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
            <div className={styles.identityList}>
              {identities.length > 0 ? (
                identities.map((identity, index) => (
                  <div
                    className={styles.identityRow}
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
                <p className={styles.eventMeta}>
                  Supabase nie zwrócił listy aktywnych metod logowania.
                </p>
              )}

              <div className={styles.identityRow}>
                <Badge variant="secondary">Google · Wkrótce</Badge>
                <p className={styles.eventMeta}>
                  Łączenie konta Google zostanie dodane osobno. Ten ekran nie
                  uruchamia OAuth.
                </p>
              </div>

              <div className={styles.identityRow}>
                <Badge variant="secondary">MFA · Wkrótce</Badge>
                <p className={styles.eventMeta}>
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
