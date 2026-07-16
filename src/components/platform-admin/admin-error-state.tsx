"use client";

import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function AdminErrorState({ reset }: { reset: () => void }) {
  return (
    <section className="mx-auto grid max-w-xl gap-4" aria-labelledby="admin-error-title">
      <Alert variant="destructive" className="p-5">
        <AlertTriangleIcon />
        <AlertTitle>
          <h1 id="admin-error-title" className="m-0 text-lg">
            Nie udało się wczytać panelu
          </h1>
        </AlertTitle>
        <AlertDescription className="mt-2">
          Wystąpił bezpiecznie ukryty błąd infrastruktury. Spróbuj ponownie za
          chwilę.
        </AlertDescription>
      </Alert>
      <Button type="button" className="justify-self-start" onClick={reset}>
        <RotateCcwIcon />
        Spróbuj ponownie
      </Button>
    </section>
  );
}
