import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OperatorLoginForm } from "../../components/operator/login-form";
import { UnauthorizedSignIn } from "../../components/operator/unauthorized-sign-in";
import { getSignInPageAccess } from "../../server/operator-api/supabase-session";

export const metadata: Metadata = {
  title: "Logowanie | Poza Nutą",
};

export const dynamic = "force-dynamic";

type SignInPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const access = await getSignInPageAccess();
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const authError = getAuthErrorMessage(resolvedSearchParams.auth_error);

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
        {access.state === "unauthorized" ? (
          <UnauthorizedSignIn />
        ) : (
          <>
            <h1>Logowanie do dashboardu</h1>
            <p className={"mt-3 mb-7 leading-relaxed text-muted-foreground"}>
              Zaloguj się, aby zarządzać kolejką aktywnego wydarzenia.
            </p>
            {authError ? (
              <p className={"m-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm leading-relaxed text-destructive"} role="alert">
                {authError}
              </p>
            ) : null}
            <OperatorLoginForm />
            <p className={"mt-1 text-center text-sm text-muted-foreground [&_a]:font-semibold [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline"}>
              Nie masz konta? <Link href="/sign-up">Zarejestruj się</Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}

function getAuthErrorMessage(value: string | string[] | undefined) {
  const code = Array.isArray(value) ? value[0] : value;

  if (code === "invalid_link") {
    return "Link email wygasł albo jest nieprawidłowy. Spróbuj zalogować się ponownie.";
  }

  return null;
}
