import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OperatorLoginForm } from "../../components/operator/login-form";
import { UnauthorizedSignIn } from "../../components/operator/unauthorized-sign-in";
import styles from "../../components/operator/operator.module.css";
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
    <main className={styles.loginPage}>
      <section className={styles.loginCard}>
        <Link
          className={styles.brand}
          href="/"
          aria-label="Przejdź na stronę główną"
        >
          <Image
            className={styles.brandLogo}
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
            <p className={styles.loginIntro}>
              Zaloguj się, aby zarządzać kolejką aktywnego wydarzenia.
            </p>
            {authError ? (
              <p className={styles.formError} role="alert">
                {authError}
              </p>
            ) : null}
            <OperatorLoginForm />
            <p className={styles.authSwitch}>
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
