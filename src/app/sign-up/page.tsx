import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OperatorSignupForm } from "../../components/operator/signup-form";
import { getSignInPageAccess } from "../../server/operator-api/supabase-session";

export const metadata: Metadata = {
  title: "Rejestracja | Poza Nutą",
};

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  const access = await getSignInPageAccess();

  if (access.state === "authorized") {
    redirect("/dashboard");
  }

  return (
    <main className={"grid min-h-screen place-items-center bg-background px-4 py-8 text-foreground"}>
      <section className={"w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-lg sm:p-10 [&_h1]:text-[clamp(1.75rem,6vw,2.25rem)] [&_h1]:font-semibold [&_h1]:leading-tight"}>
        <Link
          className={"mb-3 inline-flex w-fit items-center leading-none focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"}
          href="/"
          aria-label="Przejdź na stronę główną"
        >
          <Image
            className={"block h-8 w-auto object-contain"}
            src="/brand/poza_nuta_logo-white.png"
            alt="Poza Nutą"
            width={1254}
            height={1254}
          />
        </Link>
        <h1>Załóż konto</h1>
        <p className={"mt-3 mb-7 leading-relaxed text-muted-foreground"}>
          Utwórz konto, a potem skonfiguruj swoją organizację w dashboardzie.
        </p>
        <OperatorSignupForm />
      </section>
    </main>
  );
}
