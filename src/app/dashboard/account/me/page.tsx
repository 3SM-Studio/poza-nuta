import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import styles from "../../../../components/operator/operator.module.css";
import { sanitizeAuthIdentities } from "../../../../server/operator-api/account";
import { requireOperatorSession } from "../../../../server/operator-api/supabase-session";

export const metadata: Metadata = {
  title: "Moje konto | Poza Nutą",
};

export const dynamic = "force-dynamic";

export default async function DashboardAccountMePage() {
  const session = await requireOperatorSession();
  const {
    data: { user },
  } = await session.supabase.auth.getUser();
  const identities = sanitizeAuthIdentities(user?.identities);

  return (
    <main className={styles.queuePage}>
      <section className={styles.organizationShell}>
        <header className={styles.pageHeader}>
          <div>
            <h1>Moje konto</h1>
            <p className={styles.eventMeta}>
              Dane logowania z Supabase Auth i lokalnego operatora.
            </p>
          </div>
        </header>

        <div className={styles.organizationList}>
          <Card>
            <CardHeader>
              <CardTitle>Użytkownik Auth</CardTitle>
              <CardDescription>
                Widok techniczny tylko do odczytu. Tokeny i sekrety nie są
                wyświetlane.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className={styles.eventDetails}>
                <div>
                  <dt>Email</dt>
                  <dd>{session.authUser.email ?? "Brak emaila"}</dd>
                </div>
                <div>
                  <dt>User ID</dt>
                  <dd className={styles.breakValue}>{session.authUser.id}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lokalny operator</CardTitle>
              <CardDescription>
                Dostęp do dashboardu wynika z aktywnego operatora w bazie.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className={styles.eventDetails}>
                <div>
                  <dt>Nazwa</dt>
                  <dd>{session.operator.name}</dd>
                </div>
                <div>
                  <dt>Operator ID</dt>
                  <dd>{session.operator.id}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Metody logowania</CardTitle>
              <CardDescription>
                Google linking nie jest częścią tego etapu.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {identities.length > 0 ? (
                <div className={styles.identityList}>
                  {identities.map((identity, index) => (
                    <div
                      className={styles.identityRow}
                      key={`${identity.provider}-${identity.identityId ?? index}`}
                    >
                      <Badge>{identity.provider}</Badge>
                      <dl>
                        <div>
                          <dt>Identity ID</dt>
                          <dd className={styles.breakValue}>
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
                <p className={styles.eventMeta}>
                  Supabase nie zwrócił listy metod logowania.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
