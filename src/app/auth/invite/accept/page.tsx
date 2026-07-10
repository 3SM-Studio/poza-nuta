import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import styles from "../../../../components/operator/operator.module.css";

export const metadata: Metadata = {
  title: "Zaproszenie | Poza Nuta",
};

export const dynamic = "force-dynamic";

export default function InviteAcceptPage() {
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
        <h1>Otrzymałeś zaproszenie do konfiguracji platformy</h1>
        <form action="/auth/confirm" method="post">
          <button
            className={`${styles.button} ${styles.primaryButton} ${styles.loginButton}`}
            type="submit"
          >
            Zaakceptuj zaproszenie
          </button>
        </form>
      </section>
    </main>
  );
}
