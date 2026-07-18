import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";


export function DashboardRuntimeError({
  title = "Nie udało się wczytać dashboardu",
  description = "Baza danych albo usługa logowania odpowiedziała zbyt wolno. Spróbuj odświeżyć stronę za chwilę.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <main className={"min-h-[calc(100vh-4.5rem)] min-w-0 bg-background text-foreground"}>
      <section className={"mx-auto w-full min-w-0 max-w-[72rem]"}>
        <Card className={"mb-4"}>
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
