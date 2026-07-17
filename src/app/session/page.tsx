import type { Metadata } from "next";

import { SessionCodeForm } from "@/components/public/session-code-form";
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

export default function SessionEntryPage() {
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
          <SessionCodeForm />
        </CardContent>
      </Card>
    </main>
  );
}
