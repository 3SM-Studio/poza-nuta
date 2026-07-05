import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import styles from "../../../../components/operator/operator.module.css";

export const metadata: Metadata = {
  title: "Bezpieczeństwo konta | Poza Nutą",
};

export default function AccountSecurityPage() {
  return (
    <main className={styles.queuePage}>
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
              Ustawienia logowania będą dostępne po wdrożeniu łączenia kont.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className={styles.eventMeta}>
              Na tym etapie konto pozostaje zarządzane przez istniejący flow
              Supabase Auth. Łączenie kont Google i zaawansowane akcje
              bezpieczeństwa nie są tutaj dodawane.
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
