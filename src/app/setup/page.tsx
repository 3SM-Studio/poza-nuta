import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  PlatformSetupFinalizeForm,
  PlatformSetupSignupForm,
} from "../../components/operator/setup-forms";
import styles from "../../components/operator/operator.module.css";
import { getVerifiedSetupUserFromRequest } from "../../server/setup/auth";
import { getPlatformBootstrapState } from "../../server/setup/service";

export const metadata: Metadata = {
  title: "Setup | Poza Nuta",
};

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const bootstrapState = await getPlatformBootstrapState();

  if (bootstrapState.state === "initialized") {
    redirect("/dashboard");
  }

  const user = await getVerifiedSetupUserFromRequest();

  return (
    <main className={styles.loginPage}>
      <section className={styles.loginCard}>
        <Link
          className={styles.brand}
          href="/"
          aria-label="Przejdz na strone glowna"
        >
          <Image
            className={styles.brandLogo}
            src="/brand/poza_nuta_logo-white.png"
            alt="Poza Nuta"
            width={1254}
            height={1254}
          />
        </Link>
        <h1>Setup platformy</h1>
        {renderSetupContent(bootstrapState.state, user)}
      </section>
    </main>
  );
}

function renderSetupContent(
  platformState: "uninitialized" | "inconsistent",
  user: Awaited<ReturnType<typeof getVerifiedSetupUserFromRequest>>,
) {
  if (platformState === "inconsistent") {
    return (
      <section className={styles.signupConfirmation} role="alert">
        <h2>Konfiguracja wymaga interwencji</h2>
        <p>Platforma ma czesciowe dane i nie moze zostac przejeta automatycznie.</p>
      </section>
    );
  }

  if (user.status !== "authenticated") {
    return <PlatformSetupSignupForm />;
  }

  if (!user.emailConfirmed) {
    return (
      <section className={styles.signupConfirmation} role="status">
        <h2>Potwierdz email</h2>
        <p>Po potwierdzeniu adresu email wrocisz tutaj, aby zakonczyc setup.</p>
      </section>
    );
  }

  return <PlatformSetupFinalizeForm />;
}
