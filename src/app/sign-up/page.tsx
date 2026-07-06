import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OperatorSignupForm } from "../../components/operator/signup-form";
import styles from "../../components/operator/operator.module.css";
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
        <h1>Załóż konto</h1>
        <p className={styles.loginIntro}>
          Utwórz konto, a potem skonfiguruj swoją organizację w dashboardzie.
        </p>
        <OperatorSignupForm />
      </section>
    </main>
  );
}
