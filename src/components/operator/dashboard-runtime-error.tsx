import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import styles from "./operator.module.css";

export function DashboardRuntimeError({
  title = "Nie udało się wczytać dashboardu",
  description = "Baza danych albo usługa logowania odpowiedziała zbyt wolno. Spróbuj odświeżyć stronę za chwilę.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <main className={styles.queuePage}>
      <section className={styles.overviewShell}>
        <Card className={styles.overviewCard}>
          <CardHeader>
            <CardDescription>Awaria zależności</CardDescription>
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription>{description}</CardDescription>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
