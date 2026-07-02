import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OperatorLoginForm } from "../../components/operator/login-form";
import { UnauthorizedSignIn } from "../../components/operator/unauthorized-sign-in";
import styles from "../../components/operator/operator.module.css";
import { getSignInPageAccess } from "../../server/operator-api/supabase-session";

export const metadata: Metadata = {
  title: "Logowanie | Poza Nutą",
};

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const access = await getSignInPageAccess();

  if (access.state === "authorized") {
    redirect("/dashboard");
  }

  return (
    <main className={styles.loginPage}>
      <section className={styles.loginCard}>
        <p className={styles.brand}>Poza Nutą</p>
        {access.state === "unauthorized" ? (
          <UnauthorizedSignIn />
        ) : (
          <>
            <h1>Logowanie do dashboardu</h1>
            <p className={styles.loginIntro}>
              Zaloguj się, aby zarządzać kolejką aktywnego wydarzenia.
            </p>
            <OperatorLoginForm />
          </>
        )}
      </section>
    </main>
  );
}
