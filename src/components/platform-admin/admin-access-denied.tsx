import Link from "next/link";
import { ShieldXIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function AdminAccessDenied() {
  return (
    <main
      data-admin-access-denied="true"
      data-management-theme="true"
      className="grid min-h-screen place-items-center bg-background p-4 text-foreground"
    >
      <section className="w-full max-w-lg" aria-labelledby="access-denied-title">
        <Alert className="p-5">
          <ShieldXIcon />
          <AlertTitle>
            <h1 id="access-denied-title" className="m-0 text-lg">
              Dostęp niedostępny
            </h1>
          </AlertTitle>
          <AlertDescription className="mt-2">
            Nie możesz otworzyć tego obszaru. Nie ujawniamy szczegółów dostępu
            ani konfiguracji konta.
          </AlertDescription>
        </Alert>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/dashboard">Panel organizatora</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/sign-in">Logowanie</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
