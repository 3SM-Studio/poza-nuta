import type { Metadata } from "next";
import { CircleAlert, ShieldAlert } from "lucide-react";

import { SessionCodeForm } from "@/components/public/session-code-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Dołącz do sesji | Poza Nutą",
};

export default async function JoinPage({
  searchParams,
}: {
  searchParams?: Promise<{ joinError?: string }>;
}) {
  const joinError = (await searchParams)?.joinError;

  return (
    <main className="mx-auto flex min-h-[70svh] w-full max-w-md items-center px-4 py-10">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Dołącz do sesji</CardTitle>
          <CardDescription>
            Wpisz ośmiocyfrowy kod widoczny u organizatora wydarzenia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SessionCodeForm destinationBasePath="/join" />
          {joinError ? <JoinErrorAlert kind={joinError} /> : null}
        </CardContent>
      </Card>
    </main>
  );
}

function JoinErrorAlert({ kind }: { kind: string }) {
  const limited = kind === "rate-limited";
  const unavailable = kind === "unavailable";
  const Icon = limited ? ShieldAlert : CircleAlert;

  return (
    <Alert className="mt-4" variant={limited ? "destructive" : "default"}>
      <Icon aria-hidden="true" />
      <AlertTitle>
        {limited
          ? "Zbyt wiele prób"
          : unavailable
            ? "Kod jest chwilowo niedostępny"
            : "Kod jest nieaktywny"}
      </AlertTitle>
      <AlertDescription>
        {limited
          ? "Odczekaj chwilę przed kolejną próbą."
          : unavailable
            ? "Nie udało się teraz sprawdzić kodu. Spróbuj ponownie za chwilę."
            : "Sprawdź osiem cyfr albo poproś organizatora o aktualny kod."}
      </AlertDescription>
    </Alert>
  );
}
